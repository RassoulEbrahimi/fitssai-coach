import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";

// DE-only mode: Language switcher disabled, kept for future re-enable
const LanguageSwitcher = () => {
  return null; // Hidden in German-only mode
};

export default LanguageSwitcher;