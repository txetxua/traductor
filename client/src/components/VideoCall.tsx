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

  useEffect(() => {
    async function setupCall() {
      try {
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
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream;
            }
          },
          (state) => {
            if (state === 'connected') {
              toast({
                title: "Conectado",
                description: "La conexión se ha establecido correctamente"
              });
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
        setError(error.message);
        toast({
          variant: "destructive",
          title: "Error",
          description: error.message
        });
      }
    }

    setupCall();

    return () => {
      webrtcRef.current?.close();
    };
  }, [roomId, toast]);

  const handleHangup = () => {
    webrtcRef.current?.close();
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
            <div className="bg-destructive p-4 rounded-lg">
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
        connectionState={undefined}
        roomId={roomId}
        onHangup={handleHangup}
      />
    </div>
  );
}