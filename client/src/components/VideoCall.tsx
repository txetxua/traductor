import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { WebRTCConnection } from "@/lib/webrtc";
import { type Language } from "@shared/schema";
import CallControls from "@/components/CallControls";
import { useToast } from "@/hooks/use-toast";

interface Props {
  roomId: string;
  language: Language;
  onLanguageChange: (lang: Language) => void;
}

export default function VideoCall({ roomId, language, onLanguageChange }: Props) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const webrtcRef = useRef<WebRTCConnection>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [error, setError] = useState<string>();
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>();

  useEffect(() => {
    async function setupCall() {
      try {
        console.log("[VideoCall] Setting up call for room:", roomId);

        // Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });

        // Set local video
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Initialize WebRTC
        const webrtc = new WebRTCConnection(
          roomId,
          (remoteStream) => {
            console.log("[VideoCall] Received remote stream");
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream;
            }
          },
          (state) => {
            console.log("[VideoCall] Connection state:", state);
            setConnectionState(state);
            if (state === 'connected') {
              setError(undefined);
              toast({
                title: "Conectado",
                description: "La conexión se ha establecido correctamente"
              });
            } else if (state === 'failed' || state === 'disconnected') {
              setError("La conexión se ha perdido. Intentando reconectar...");
            }
          },
          (error) => {
            console.error("[VideoCall] Error:", error);
            setError(error.message);
            toast({
              variant: "destructive",
              title: "Error de conexión",
              description: error.message
            });
          }
        );

        await webrtc.start(stream);
        webrtcRef.current = webrtc;

      } catch (error: any) {
        console.error("[VideoCall] Setup error:", error);
        const errorMessage = error.name === 'NotAllowedError' 
          ? "No se ha permitido el acceso a la cámara y micrófono. Por favor, conceda los permisos necesarios."
          : error.message;

        setError(errorMessage);
        toast({
          variant: "destructive",
          title: "Error",
          description: errorMessage
        });
      }
    }

    setupCall();

    return () => {
      console.log("[VideoCall] Cleaning up");
      if (webrtcRef.current) {
        webrtcRef.current.close();
      }
    };
  }, [roomId, toast]);

  const handleHangup = () => {
    console.log("[VideoCall] Hanging up");
    if (webrtcRef.current) {
      webrtcRef.current.close();
    }
    setLocation("/");
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex-1 relative">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover bg-black/10"
          aria-label="Video remoto"
        />

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
            <div className="bg-destructive p-4 rounded-lg max-w-md text-center">
              {error}
            </div>
          </div>
        )}

        <div className="absolute top-4 right-4 w-48 aspect-video">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover rounded-lg shadow-lg bg-black/10"
            aria-label="Video local"
          />
        </div>
      </div>

      <CallControls
        language={language}
        onLanguageChange={onLanguageChange}
        connectionState={connectionState}
        roomId={roomId}
        onHangup={handleHangup}
      />
    </div>
  );
}