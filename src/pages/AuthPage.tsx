import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import SignInFlow from "@/components/auth/SignInFlow";

const AuthPage = () => {
  return <SignInFlow />;
};

export default AuthPage;
