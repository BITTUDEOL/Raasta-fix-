import { useEffect, useState } from 'react';
import { MapPin, Camera, Send, Loader, AlertTriangle } from 'lucide-react';
import { Report } from '../types';
import { getCurrentLocation, getDemoLocation, reverseGeocode } from '../utils/geocoding';
import { storageUtils } from '../utils/storage';
import { checkWeather, isRainyHazard } from '../utils/weather';
import { extractLocationFromImage } from '../utils/exif';

interface ReportFormProps {
  onSubmit: (report: Report) => void;
  currentUserName: string;
  currentUserEmail: string;
  isDark: boolean;
}

const issueTypes = [
  { value: 'pothole', label: 'Pothole / Road Damage', icon: '🕳️' },
  { value: 'streetlight', label: 'Broken Streetlight', icon: '💡' },
  { value: 'water-leak', label: 'Water Leakage', icon: '💧' },
  { value: 'waste', label: 'Illegal Waste Dumping', icon: '🗑️' },
  { value: 'manhole', label: 'Open Manhole / Safety Hazard', icon: '⚠️' }
];

export default function ReportForm({ onSubmit, currentUserName, currentUserEmail, isDark }: ReportFormProps) {
  const [issueType, setIssueType] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<'pending' | 'success' | 'fallback'>('pending');

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
      };
      reader.readAsDataURL(file);
      // *Do not set location from EXIF yet*
    }
  };

  const handleGetLocation = async () => {
    setLocationStatus('pending');
    try {
      // Try live geolocation first (highest priority)
      const liveLoc = await getCurrentLocation();
      setLocation(liveLoc);
      setLocationStatus('success');
    } catch (error) {
      // Try EXIF from image if available (second priority)
      if (image) {
        const fileInput = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
        const file = fileInput?.files?.[0];
        if (file) {
          try {
            const exifLoc = await extractLocationFromImage(file);
            if (exifLoc) {
              setLocation(exifLoc);
              setLocationStatus('fallback');
              return;
            }
          } catch (exifError) {
            console.error('EXIF extraction failed:', exifError);
          }
        }
      }
      // Final fallback to demo location
      const demoLoc = getDemoLocation();
      setLocation(demoLoc);
      setLocationStatus('fallback');
    }
  };

  // Always try for live location on submit
  const getBestLocation = async () => {
    try {
      // Always try live geolocation first
      const liveLoc = await getCurrentLocation();
      setLocation(liveLoc);
      setLocationStatus('success');
      return liveLoc;
    } catch (geoError: any) {
      // Try to extract from last uploaded image (EXIF backup)
      if (image) {
        try {
          const fileInput = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
          const file = fileInput?.files?.[0];
          if (file) {
            const exifLoc = await extractLocationFromImage(file);
            if (exifLoc) {
              setLocation(exifLoc);
              setLocationStatus('fallback');
              return exifLoc;
            }
          }
        } catch (exifError) {
          // ignore
        }
      }
      // fallback to demo location
      const demoLoc = getDemoLocation();
      setLocation(demoLoc);
      setLocationStatus('fallback');
      return demoLoc;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueType || !title.trim() || !description.trim()) {
      alert('Please fill in all required fields');
      return;
    }
    if (!image) {
      alert('Please upload a photo of the issue. Photo is mandatory.');
      return;
    }
    setIsSubmitting(true);
    let finalLocation: { lat: number; lng: number } | null = null;
    finalLocation = await getBestLocation();

    try {
      // BEFORE creating the report, check for duplicate same-type report at same location
      const existing = storageUtils.getReports();
      const key = `${finalLocation.lat.toFixed(5)},${finalLocation.lng.toFixed(5)}`;
      const duplicate = existing.find(r => {
        const rKey = `${r.location.lat.toFixed(5)},${r.location.lng.toFixed(5)}`;
        return rKey === key && r.type === issueType && r.status !== 'resolved';
      });

      if (duplicate) {
        // notify user that same issue already exists and do not submit
        const note = {
          id: Date.now().toString(),
          type: 'system',
          message: `A similar issue ("${duplicate.title}") has already been reported at this location. Your report was not submitted.`,
          reportId: duplicate.id,
          read: false,
          timestamp: new Date().toISOString()
        };
        if (currentUserEmail) {
          storageUtils.addNotificationToUser(currentUserEmail, note as any);
        }
        alert('A similar issue has already been reported at this location. We have notified you.');
        setIsSubmitting(false);
        return;
      }

      const address = await reverseGeocode(finalLocation.lat, finalLocation.lng);
      const weather = await checkWeather(finalLocation.lat, finalLocation.lng);
      const isHazard = isRainyHazard(issueType, weather);

      const report: Report = {
        id: Date.now().toString(),
        type: issueType as Report['type'],
        title: title.trim(),
        description: description.trim(),
        location: {
          lat: finalLocation.lat,
          lng: finalLocation.lng,
          address
        },
        status: 'pending',
        priority: isHazard ? 'critical' : issueType === 'manhole' ? 'high' : 'medium',
        imageUrl: image || undefined,
        isRainyHazard: isHazard,
        reportedBy: currentUserName,
        reportedByEmail: currentUserEmail,
        reportedAt: new Date().toISOString(),
        upvotes: 0,
        downvotes: 0,
        votedBy: [],
        comments: [],
        views: 0,
        shareCount: 0,
        tags: [issueType]
      };

      onSubmit(report);

      setIssueType('');
      setTitle('');
      setDescription('');
      setImage(null);
      setLocation(null);

      alert('Report submitted successfully!');
    } catch (error) {
      alert('Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`rounded-3xl backdrop-blur-xl border-2 shadow-2xl p-6 lg:p-8 transition-all duration-300 hover:shadow-3xl ${isDark
        ? 'bg-gradient-to-br from-gray-800/90 to-gray-900/90 border-gray-700/50'
        : 'bg-gradient-to-br from-white/90 to-gray-50/90 border-gray-200/50'
      }`}>
      <div className="mb-8">
        <h2 className={`text-3xl font-extrabold mb-2 bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 bg-clip-text text-transparent`}>
          Report an Issue
        </h2>
        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          Help improve your community
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={`block text-sm font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            Issue Type *
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {issueTypes.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => setIssueType(type.value)}
                className={`p-5 rounded-2xl border-2 transition-all duration-300 text-left transform hover:scale-105 ${issueType === type.value
                    ? 'border-orange-500 bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-900/30 dark:to-red-900/30 shadow-xl scale-105'
                    : isDark
                      ? 'border-gray-600/50 hover:border-gray-500 bg-gray-700/50 hover:bg-gray-700'
                      : 'border-gray-200/50 hover:border-orange-300/50 bg-white/50 hover:bg-white backdrop-blur-sm'
                  }`}
              >
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{type.icon}</span>
                  <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {type.label}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={`block text-sm font-bold mb-3 uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            Issue Title *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`w-full px-5 py-4 rounded-2xl border-2 backdrop-blur-sm transition-all duration-300 ${isDark
                ? 'bg-gray-700/80 border-gray-600/50 text-white placeholder-gray-400 hover:border-orange-500/50 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/20'
                : 'bg-white/80 border-gray-300/50 text-gray-900 placeholder-gray-500 hover:border-orange-400/50 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/20'
              } focus:outline-none shadow-lg`}
            placeholder="Brief description of the issue"
            required
          />
        </div>

        <div>
          <label className={`block text-sm font-bold mb-3 uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            Detailed Description *
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className={`w-full px-5 py-4 rounded-2xl border-2 backdrop-blur-sm transition-all duration-300 ${isDark
                ? 'bg-gray-700/80 border-gray-600/50 text-white placeholder-gray-400 hover:border-orange-500/50 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/20'
                : 'bg-white/80 border-gray-300/50 text-gray-900 placeholder-gray-500 hover:border-orange-400/50 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/20'
              } focus:outline-none shadow-lg`}
            placeholder="Provide detailed information about the issue..."
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={`block text-sm font-bold mb-3 uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              Add Photo *
            </label>
            <label
              className={`flex items-center justify-center space-x-2 px-6 py-4 rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-300 hover:scale-105 ${isDark
                  ? 'border-gray-600/50 hover:border-orange-500/50 bg-gray-700/50 hover:bg-gray-700/80'
                  : 'border-gray-300/50 hover:border-orange-400/50 bg-gray-50/80 hover:bg-white/80 backdrop-blur-sm'
                } shadow-lg hover:shadow-xl`}
            >
              <Camera className={`w-5 h-5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
              <span className={`text-sm font-semibold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {image ? 'Change Photo' : 'Upload Photo'}
              </span>
              <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" required />
            </label>
          </div>

          <div>
            <label className={`block text-sm font-bold mb-3 uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              Location
            </label>
            <button
              type="button"
              onClick={handleGetLocation}
              className={`w-full flex items-center justify-center space-x-2 px-6 py-4 rounded-2xl transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl ${location
                  ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white'
                  : isDark
                    ? 'bg-gray-700/80 hover:bg-gray-600/80 text-gray-300 border-2 border-gray-600/50'
                    : 'bg-gray-100/80 hover:bg-gray-200/80 text-gray-700 border-2 border-gray-200/50 backdrop-blur-sm'
                }`}
            >
              <MapPin className="w-5 h-5" />
              <span className="text-sm font-medium">{location ? 'Location Set ✓' : 'Get Location'}</span>
            </button>

            {/* Location Status Messages */}
            {locationStatus === 'pending' && (
              <div className={`mt-3 p-3 rounded-xl ${isDark ? 'bg-blue-900/20 border border-blue-800/30' : 'bg-blue-50/80 border border-blue-200/50'}`}>
                <p className={`text-xs flex items-center gap-2 ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
                  <span className="animate-spin">🔄</span>
                  Detecting your current location...
                </p>
              </div>
            )}

            {locationStatus === 'success' && location && (
              <div className={`mt-3 p-3 rounded-xl ${isDark ? 'bg-green-900/20 border border-green-800/30' : 'bg-green-50/80 border border-green-200/50'}`}>
                <p className={`text-xs font-semibold mb-1 ${isDark ? 'text-green-300' : 'text-green-700'}`}>
                  ✓ Live Location Captured
                </p>
                <p className={`text-xs ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                  📍 {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                </p>
              </div>
            )}

            {locationStatus === 'fallback' && location && (
              <div className={`mt-3 p-3 rounded-xl ${isDark ? 'bg-yellow-900/20 border border-yellow-800/30' : 'bg-yellow-50/80 border border-yellow-200/50'}`}>
                <p className={`text-xs font-semibold mb-1 ${isDark ? 'text-yellow-300' : 'text-yellow-700'}`}>
                  ⚠️ Using Fallback Location
                </p>
                <p className={`text-xs ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
                  {image ? 'Extracted from image EXIF data or using demo location' : 'Using demo location'}
                </p>
                <p className={`text-xs mt-1 ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
                  📍 {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                </p>
              </div>
            )}
          </div>
        </div>

        {image && (
          <div className="relative rounded-2xl overflow-hidden shadow-xl border-2 border-gray-200/50 dark:border-gray-700/50">
            <img src={image} alt="Preview" className="w-full h-48 object-cover" />
            <button
              type="button"
              onClick={() => setImage(null)}
              className="absolute top-3 right-3 p-2.5 bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white rounded-full shadow-xl hover:scale-110 transition-all duration-300"
            >
              <span className="text-sm font-bold">✕</span>
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 hover:from-orange-600 hover:via-red-600 hover:to-pink-600 disabled:from-gray-400 disabled:via-gray-400 disabled:to-gray-400 text-white font-bold py-5 rounded-2xl transition-all duration-300 transform hover:scale-105 shadow-xl hover:shadow-2xl disabled:scale-100 disabled:shadow-lg"
        >
          {isSubmitting ? (
            <>
              <Loader className="w-5 h-5 animate-spin" />
              <span>Submitting...</span>
            </>
          ) : (
            <>
              <Send className="w-5 h-5" />
              <span>Submit Report</span>
            </>
          )}
        </button>

        <div className={`flex items-start space-x-3 p-5 rounded-2xl backdrop-blur-sm border-2 ${isDark
            ? 'bg-blue-900/20 border-blue-800/30'
            : 'bg-blue-50/80 border-blue-200/50'
          }`}>
          <AlertTriangle className="w-6 h-6 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className={`text-sm leading-relaxed ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
            Your report will be reviewed by local authorities. Critical issues (especially during rain) are prioritized automatically.
          </p>
        </div>
      </form>
    </div>
  );
}
