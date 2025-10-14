import React from "react";

const VideoBackground: React.FC = () => {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
      data-test-id="video-bg-root"
    >
      {/* Poster image shown immediately while video loads */}
      <img 
        src="/video/dashboard-bg.png" 
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        aria-hidden="true"
      />

      {/* Animated background video (hidden in reduce-motion by CSS) */}
      <video
        className="bg-video absolute inset-0 w-full h-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        poster="/video/dashboard-bg.png"
        data-test-id="video-bg-video"
      >
        <source src="/video/dashboard-bg.webm" type="video/webm" />
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
