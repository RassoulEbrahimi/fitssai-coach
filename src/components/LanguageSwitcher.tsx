import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";

const LanguageSwitcher = () => {
  const { i18n } = useTranslation();

  const changeLanguage = (language: string) => {
    // Add smooth transition effect for language changes
    document.documentElement.style.transition = 'opacity 0.3s ease-in-out';
    document.documentElement.style.opacity = '0.8';
    
    setTimeout(() => {
      i18n.changeLanguage(language);
      localStorage.setItem('language', language);
      document.documentElement.style.opacity = '1';
      setTimeout(() => {
        document.documentElement.style.transition = '';
      }, 300);
    }, 150);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 transition-all duration-200 hover:scale-105">
          <motion.div
            whileHover={{ rotate: 15 }}
            transition={{ duration: 0.2 }}
          >
            <Languages className="h-4 w-4" />
          </motion.div>
          <motion.span 
            className="hidden sm:inline"
            key={i18n.language}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
          >
            {i18n.language === 'fa' ? 'فارسی' : i18n.language === 'de' ? 'Deutsch' : 'English'}
          </motion.span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <DropdownMenuItem 
            onClick={() => changeLanguage('de')} 
            className="cursor-pointer transition-colors duration-200 hover:bg-primary/10"
          >
            Deutsch
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={() => changeLanguage('en')} 
            className="cursor-pointer transition-colors duration-200 hover:bg-primary/10"
          >
            English
          </DropdownMenuItem>
          <DropdownMenuItem 
            onClick={() => changeLanguage('fa')} 
            className="cursor-pointer transition-colors duration-200 hover:bg-primary/10"
          >
            فارسی
          </DropdownMenuItem>
        </motion.div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default LanguageSwitcher;