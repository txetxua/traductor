import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Language } from "@shared/schema";
import { Video, VideoOff, Mic, MicOff } from "lucide-react";
import { useState } from "react";

interface Props {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  connectionState?: RTCPeerConnectionState;
}

export default function CallControls({ 
  language,
  onLanguageChange,
  connectionState 
}: Props) {
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);

  return (
    <div className="h-20 bg-muted border-t flex items-center justify-center gap-4 px-4">
      <Button
        variant="outline"
        size="icon"
        onClick={() => setVideoEnabled(!videoEnabled)}
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
        onClick={() => setAudioEnabled(!audioEnabled)}
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

      <div className="text-sm text-muted-foreground">
        Estado: {connectionState || "Conectando..."}
      </div>
    </div>
  );
}
