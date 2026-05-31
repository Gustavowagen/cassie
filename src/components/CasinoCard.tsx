import { useNavigate } from "react-router-dom";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import type { Casino } from "../types";

export function CasinoCard({ casino }: { casino: Casino }) {
  const navigate = useNavigate();
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader>
        <CardTitle>{casino.name}</CardTitle>
        <CardDescription>{casino.description ?? "No description"}</CardDescription>
      </CardHeader>
      <CardFooter className="flex justify-between items-center">
        <Badge variant="outline">
          {casino.settings.startingBalance.toLocaleString()} chips
        </Badge>
        <Button size="sm" onClick={() => navigate(`/casino/${casino.slug}`)}>
          Enter
        </Button>
      </CardFooter>
    </Card>
  );
}
