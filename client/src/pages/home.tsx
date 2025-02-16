import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { Video, Mic } from "lucide-react";

export default function Home() {
  const [, setLocation] = useLocation();
  const [videoEnabled, setVideoEnabled] = useState(true);

  const startCall = async () => {
    try {
      const roomId = Math.random().toString(36).substring(7);
      await apiRequest("POST", "/api/calls", { roomId, videoEnabled });
      setLocation(`/call/${roomId}`);
    } catch (error) {
      console.error("Failed to start call:", error);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-background to-primary/5">
      <Card className="w-[90%] max-w-md mx-4">
        <CardHeader>
          <CardTitle className="text-2xl text-center text-white">
            Videollamadas con Traducción
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="flex items-center justify-between space-x-4">
              <div className="flex items-center space-x-2">
                {videoEnabled ? <Video className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                <Label>Modo de llamada</Label>
              </div>
              <Switch
                checked={videoEnabled}
                onCheckedChange={setVideoEnabled}
              />
            </div>
            <Button
              className="w-full"
              size="lg"
              onClick={startCall}
            >
              Iniciar llamada
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}