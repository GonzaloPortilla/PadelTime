import { Link } from "react-router";
import { EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/Button";
import { MapPinOff } from "lucide-react";

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<MapPinOff className="size-6" />}
      title="Página no encontrada"
      description="La dirección no existe o fue movida."
      action={<Link to="/"><Button variant="secondary">Volver al panel</Button></Link>}
    />
  );
}
