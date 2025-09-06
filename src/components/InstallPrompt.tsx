import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const InstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  // Detect if app is already installed
  useEffect(() => {
    const checkInstalled = () => {
      // PWA is installed if it's in standalone mode
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                          (window.navigator as any).standalone === true;
      setIsInstalled(isStandalone);
    };
    
    checkInstalled();
    
    // Listen for display mode changes
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    mediaQuery.addEventListener('change', checkInstalled);
    
    return () => mediaQuery.removeEventListener('change', checkInstalled);
  }, []);

  // Listen for beforeinstallprompt (Android/Chromium)
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Detect iOS Safari
  const isIOSSafari = () => {
    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
    const isStandalone = (window.navigator as any).standalone;
    
    return isIOS && isSafari && !isStandalone;
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // Android/Chromium - show native prompt
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          setDeferredPrompt(null);
        }
      } catch (error) {
        console.log('Install prompt failed:', error);
      }
    } else if (isIOSSafari()) {
      // iOS Safari - show instructions
      setShowIOSInstructions(true);
    }
  };

  // Don't show if already installed
  if (isInstalled) return null;

  // Show install button if we have a deferred prompt or on iOS Safari
  const canInstall = deferredPrompt || isIOSSafari();
  
  if (!canInstall) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleInstallClick}
        className="pwa-install-btn"
      >
        <Download className="h-4 w-4 mr-2" />
        App installieren
      </Button>

      <Dialog open={showIOSInstructions} onOpenChange={setShowIOSInstructions}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              Zum Home-Bildschirm hinzufügen
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowIOSInstructions(false)}
                className="h-6 w-6 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
            <DialogDescription className="text-left space-y-3">
              <p>
                Öffne das Teilen-Menü und tippe auf „Zum Home-Bildschirm", 
                um FitssAI zu installieren.
              </p>
              <div className="text-sm text-muted-foreground">
                1. Tippe auf das Teilen-Symbol (Quadrat mit Pfeil nach oben)<br/>
                2. Scrolle nach unten und wähle „Zum Home-Bildschirm"<br/>
                3. Tippe auf „Hinzufügen"
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button onClick={() => setShowIOSInstructions(false)}>
              Verstanden
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default InstallPrompt;