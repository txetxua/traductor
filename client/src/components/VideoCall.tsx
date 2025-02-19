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

  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>();
  const [cameraError, setCameraError] = useState<string>();

  // Initialize media devices
  const initializeCall = async () => {
    try {
      console.log("[VideoCall] Starting call initialization");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
      });

      // Set up local video
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Initialize WebRTC
      const webrtc = new WebRTCConnection(
        roomId,
        (remoteStream) => {
          console.log("[VideoCall] Remote stream received");
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
        },
        (state) => {
          console.log("[VideoCall] Connection state changed:", state);
          setConnectionState(state);

          if (state === 'connected') {
            toast({
              title: "Conectado",
              description: "Conexión establecida exitosamente",
            });
          }
        },
        (error) => {
          console.error("[VideoCall] Error:", error);
          toast({
            variant: "destructive",
            title: "Error",
            description: error.message,
          });
        }
      );

      await webrtc.start(stream);
      webrtcRef.current = webrtc;

    } catch (error: any) {
      console.error("[VideoCall] Initialization error:", error);
      setCameraError(error.message);
    }
  };

  // Setup and cleanup
  useEffect(() => {
    console.log("[VideoCall] Setting up call for room:", roomId);
    initializeCall();

    return () => {
      console.log("[VideoCall] Cleaning up");
      if (webrtcRef.current) {
        webrtcRef.current.close();
      }
    };
  }, [roomId]);

  const handleHangup = () => {
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
          aria-label="Video de participante remoto"
        />

        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
            <div className="bg-destructive p-4 rounded-lg" role="alert">
              {cameraError}
            </div>
          </div>
        )}

        <div className="absolute top-4 right-4 w-48 aspect-video">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover rounded-lg shadow-lg bg-black/10"
            aria-label="Tu video"
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