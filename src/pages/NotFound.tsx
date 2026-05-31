import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";

export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="text-center py-24">
      <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
      <p className="mt-4 text-lg">Page not found</p>
      <Button className="mt-6" onClick={() => navigate("/")}>
        Go Home
      </Button>
    </div>
  );
}
