import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { supabase } from "../lib/supabase";

export function ConfirmEmail() {
  const navigate = useNavigate();

  useEffect(() => {
    // getSession() parses the URL hash for implicit flow — if the user landed
    // here after clicking the confirmation link, the token is already in the hash
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/", { replace: true });
    });

    // Belt-and-suspenders: also catch the SIGNED_IN event in case getSession
    // resolves before Supabase finishes processing the hash
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) navigate("/", { replace: true });
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="max-w-sm mx-auto mt-16">
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            We sent a confirmation link to your email address. Click it to
            activate your account — you'll be signed in automatically.
          </p>
          <p>If you don't see it, check your spam folder.</p>
        </CardContent>
      </Card>
    </div>
  );
}
