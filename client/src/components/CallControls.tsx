import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Language } from "@shared/schema";
import { Video, VideoOff, Mic, MicOff, Link, PhoneOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  connectionState?: RTCPeerConnectionState;
  roomId: string;
  onHangup: () => void;
  audioEnabled: boolean;
  onAudioToggle: (enabled: boolean) => void;
  videoEnabled: boolean;
  onVideoToggle: (enabled: boolean) => void;
}

export default function CallControls({ 
  language,
  onLanguageChange,
  connectionState,
  roomId,
  onHangup,
  audioEnabled,
  onAudioToggle,
  videoEnabled,
  onVideoToggle
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

  return (
    <div className="h-20 bg-muted border-t flex items-center justify-center gap-4 px-4">
      <Button
        variant="outline"
        size="icon"
        onClick={() => onVideoToggle(!videoEnabled)}
      >
        {videoEnabled ? (
          <Video className="h-4 w-4" />
        ) : (
          <VideoOff className="h-4 w-4" />
        )}
      </Button>

      <Button
        variant="outline"
        size="icon"
        onClick={() => onAudioToggle(!audioEnabled)}
      >
        {audioEnabled ? (
          <Mic className="h-4 w-4" />
        ) : (
          <MicOff className="h-4 w-4" />
        )}
      </Button>

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

      <div className="text-sm text-muted-foreground">
        Estado: {connectionState || "Conectando..."}
      </div>
    </div>
  );
}