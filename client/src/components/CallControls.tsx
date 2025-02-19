import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Language } from "@shared/schema";
import { Link, PhoneOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  connectionState?: RTCPeerConnectionState;
  roomId: string;
  onHangup: () => void;
}

export default function CallControls({ 
  language,
  onLanguageChange,
  connectionState,
  roomId,
  onHangup,
}: Props) {
  const { toast } = useToast();

  const copyRoomLink = () => {
    const url = `${window.location.origin}/call/${roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      toast({
        description: "Enlace copiado al portapapeles",
        duration: 2000
      });
    });
  };

  const getConnectionStatusText = () => {
    switch (connectionState) {
      case 'new':
        return 'Iniciando...';
      case 'connecting':
        return 'Conectando...';
      case 'connected':
        return 'Conectado';
      case 'disconnected':
        return 'Desconectado';
      case 'failed':
        return 'Error de conexión';
      case 'closed':
        return 'Llamada finalizada';
      default:
        return 'Conectando...';
    }
  };

  const getConnectionStatusClass = () => {
    switch (connectionState) {
      case 'connected':
        return 'text-green-500';
      case 'failed':
      case 'disconnected':
        return 'text-red-500';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="h-20 bg-muted border-t flex items-center justify-center gap-4 px-4">
      <Select
        value={language}
        onValueChange={(value) => onLanguageChange(value as Language)}
      >
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="es">Español</SelectItem>
          <SelectItem value="it">Italiano</SelectItem>
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="icon"
        onClick={copyRoomLink}
        title="Copiar enlace de la llamada"
      >
        <Link className="h-4 w-4" />
      </Button>

      <Button
        variant="destructive"
        size="icon"
        onClick={onHangup}
        title="Finalizar llamada"
      >
        <PhoneOff className="h-4 w-4" />
      </Button>

      <div className={`text-sm font-medium ${getConnectionStatusClass()}`}>
        {getConnectionStatusText()}
      </div>
    </div>
  );
}