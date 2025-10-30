import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface InlineEditableTextProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

export function InlineEditableText({ 
  value, 
  onChange, 
  className,
  placeholder = "Bearbeiten..."
}: InlineEditableTextProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    onChange(localValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur();
    } else if (e.key === 'Escape') {
      setLocalValue(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          "inline-block px-2 py-0.5 rounded-md",
          "bg-primary/10 border-2 border-primary/40",
          "text-foreground font-medium",
          "focus:outline-none focus:border-primary",
          "transition-all",
          className
        )}
        style={{ width: `${Math.max(localValue.length, 8)}ch` }}
      />
    );
  }

  return (
    <motion.span
      onClick={() => setIsEditing(true)}
      className={cn(
        "inline-block px-2 py-0.5 rounded-md cursor-pointer",
        "bg-primary/5 border border-primary/20 border-dashed",
        "text-primary font-medium",
        "hover:bg-primary/10 hover:border-primary/30",
        "transition-all",
        className
      )}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {localValue}
    </motion.span>
  );
}
