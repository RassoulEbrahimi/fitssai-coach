import React from "react";

const VideoBackground: React.FC = () => {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
      data-test-id="video-bg-root"
    >
      {/* Reduced-motion fallback: Use first frame of video or solid color */}
      <div className="bg-video-poster absolute inset-0 w-full h-full bg-gradient-to-b from-background/60 to-background/90" />

      {/* Animated background video (hidden in reduce-motion by CSS) */}
      <video
        className="bg-video absolute inset-0 w-full h-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        data-test-id="video-bg-video"
      >
        <source src="/video/dashboard-bg.mp4" type="video/mp4" />
        Dein Browser unterstützt kein Video-Tag.
      </video>

      {/* Contrast overlay to keep text readable */}
      <div
        className="absolute inset-0 pointer-events-none bg-gradient-to-b from-background/40 to-background/80 z-10"
        aria-hidden="true"
      />
    </div>
  );
};

export default VideoBackground;
