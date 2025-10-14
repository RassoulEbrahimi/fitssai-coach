import React, { useEffect, useRef } from "react";

const VideoBackground: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Programmatically ensure playback starts (fallback for browsers that might block autoplay)
    const playVideo = async () => {
      try {
        await video.play();
      } catch (error) {
        console.debug("Video autoplay was prevented:", error);
        // Silently fail - poster will remain visible
      }
    };

    // Attempt to play when component mounts
    playVideo();

    // Also attempt to play when video metadata is loaded
    video.addEventListener("loadedmetadata", playVideo);

    return () => {
      video.removeEventListener("loadedmetadata", playVideo);
    };
  }, []);

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
        ref={videoRef}
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
