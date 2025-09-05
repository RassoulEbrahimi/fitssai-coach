interface VideoBackgroundProps {
  srcMp4?: string;
  srcWebm?: string;
  poster?: string;
}

const DEFAULT_SRC_MP4 = "/video/dashboard-bg.mp4";
const DEFAULT_SRC_WEBM = "/video/dashboard-bg.webm";
const DEFAULT_POSTER = "/video/dashboard-bg-poster.jpg";

const VideoBackground = ({ 
  srcMp4 = DEFAULT_SRC_MP4, 
  srcWebm = DEFAULT_SRC_WEBM, 
  poster = DEFAULT_POSTER 
}: VideoBackgroundProps) => {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden">
      <video 
        className="bg-video absolute inset-0 w-full h-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        poster={poster}
        preload="metadata"
        aria-hidden="true"
      >
        <source src={srcWebm} type="video/webm" />
        <source src={srcMp4} type="video/mp4" />
      </video>
      {/* Contrast overlay so text stays readable */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-background/40 to-background/80 z-10" aria-hidden="true" />
    </div>
  );
};

export default VideoBackground;