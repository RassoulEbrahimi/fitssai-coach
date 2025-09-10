import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";

const HomeSkeleton: React.FC = () => {
  return (
    <div className="space-y-8">
      {/* Header Skeleton */}
      <motion.div 
        className="flex flex-col md:flex-row justify-between items-start md:items-center"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <div>
          <div className="h-9 bg-muted animate-pulse rounded-md w-48 mb-2"></div>
          <div className="h-5 bg-muted animate-pulse rounded-md w-64"></div>
        </div>
        <div className="flex gap-2 mt-4 md:mt-0">
          <div className="h-10 bg-muted animate-pulse rounded-md w-32"></div>
        </div>
      </motion.div>

      {/* Quick Stats Skeleton */}
      <motion.div 
        className="grid grid-cols-1 md:grid-cols-4 gap-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2, staggerChildren: 0.1 }}
      >
        {Array.from({ length: 4 }).map((_, index) => (
          <motion.div
            key={index}
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0 }
            }}
          >
            <Card className="gradient-card border-primary/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="h-4 bg-muted animate-pulse rounded-md w-20 mb-2"></div>
                    <div className="h-8 bg-muted animate-pulse rounded-md w-16"></div>
                  </div>
                  <div className="h-8 w-8 bg-muted animate-pulse rounded-md"></div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
};

export default HomeSkeleton;