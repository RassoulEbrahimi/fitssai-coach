import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface AddWorkoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'ai' | 'manual';
  dayContext?: { weekKey: string; dayIndex: number };
}

export function AddWorkoutModal({ 
  isOpen, 
  onClose, 
  mode = 'manual',
  dayContext 
}: AddWorkoutModalProps) {
  const [activeTab, setActiveTab] = useState(mode);
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Sync activeTab with mode prop when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(mode);
    }
  }, [isOpen, mode]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const modalVariants = prefersReducedMotion
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1 }
      }
    : {
        hidden: { opacity: 0, scale: 0.95 },
        visible: { opacity: 1, scale: 1 }
      };

  const overlayVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop overlay */}
          <motion.div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              className="relative w-full max-w-2xl pointer-events-auto"
              variants={modalVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
              transition={prefersReducedMotion ? { duration: 0.15 } : { duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            >
              {/* Glass container */}
              <div
                className="relative bg-background/95 backdrop-blur-xl rounded-3xl border border-primary/20 overflow-hidden"
                style={{
                  boxShadow: '0 0 40px rgba(16, 185, 129, 0.25), 0 8px 32px rgba(0, 0, 0, 0.12)',
                  willChange: 'transform, opacity'
                }}
              >
                {/* Decorative glow elements */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div
                    className="absolute -top-24 -right-24 w-48 h-48 bg-primary/20 rounded-full blur-3xl"
                    style={{ willChange: 'transform' }}
                  />
                  <div
                    className="absolute -bottom-24 -left-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl"
                    style={{ willChange: 'transform' }}
                  />
                </div>

                {/* Close button */}
                <motion.button
                  className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-muted/80 hover:bg-muted flex items-center justify-center transition-colors"
                  onClick={onClose}
                  whileTap={prefersReducedMotion ? {} : { scale: 0.95 }}
                  transition={{ duration: 0.1 }}
                  aria-label="Modal schließen"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </motion.button>

                {/* Content */}
                <div className="relative p-6 pt-8">
                  <h2 className="text-2xl font-semibold mb-6 text-center bg-gradient-to-r from-primary via-emerald-400 to-teal-400 bg-clip-text text-transparent">
                    Training hinzufügen
                  </h2>

                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'ai' | 'manual')} className="w-full">
                    <TabsList className="grid w-full grid-cols-2 mb-6 bg-muted/50">
                      <TabsTrigger 
                        value="ai" 
                        className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all"
                      >
                        <span className="mr-2">✨</span>
                        AI Suggestion
                      </TabsTrigger>
                      <TabsTrigger 
                        value="manual"
                        className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all"
                      >
                        <span className="mr-2">➕</span>
                        Manual Add
                      </TabsTrigger>
                    </TabsList>

                    <ScrollArea className="h-[400px] pr-4">
                      <TabsContent value="ai" className="mt-0">
                        <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                          <div className="text-6xl mb-4">🤖</div>
                          <p className="text-lg text-muted-foreground">
                            AI Suggestions coming soon
                          </p>
                          <p className="text-sm text-muted-foreground/70 mt-2">
                            Let AI help you plan the perfect workout
                          </p>
                        </div>
                      </TabsContent>

                      <TabsContent value="manual" className="mt-0">
                        <div className="flex flex-col items-center justify-center h-full py-16 text-center">
                          <div className="text-6xl mb-4">🏋️‍♂️</div>
                          <p className="text-lg text-muted-foreground">
                            Add exercise manually
                          </p>
                          <p className="text-sm text-muted-foreground/70 mt-2">
                            Create your custom workout plan
                          </p>
                        </div>
                      </TabsContent>
                    </ScrollArea>
                  </Tabs>

                  {/* Footer buttons */}
                  <div className="flex items-center justify-end gap-3 mt-6 pt-6 border-t border-border/50">
                    <Button
                      variant="ghost"
                      onClick={onClose}
                      className="hover:bg-muted/80"
                    >
                      Abbrechen
                    </Button>
                    <Button
                      disabled
                      className="bg-primary/20 text-primary cursor-not-allowed opacity-50"
                    >
                      Speichern
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
