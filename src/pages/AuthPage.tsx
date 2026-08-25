import { useParams } from "react-router-dom";
import SignInFlow from "@/components/auth/SignInFlow";
import { authModeFromRouteParam } from "@/lib/authRoutes";

/**
 * `/auth/:mode` — the route param decides which form opens.
 *
 * This previously rendered `<SignInFlow />` with no arguments, so the flow
 * always fell back to its own "login" default and `/auth/sign-up` showed the
 * sign-in form.
 */
const AuthPage = () => {
  const { mode } = useParams<{ mode: string }>();
  return <SignInFlow initialMode={authModeFromRouteParam(mode)} />;
};

export default AuthPage;
