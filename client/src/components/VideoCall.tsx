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
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const currentStreamRef = useRef<MediaStream | null>(null);

  const stopCurrentStream = () => {
    if (currentStreamRef.current) {
      currentStreamRef.current.getTracks().forEach(track => track.stop());
      currentStreamRef.current = null;
    }
  };

  const initializeMediaDevices = async () => {
    try {
      stopCurrentStream();
      setCameraError(undefined);

      console.log("[VideoCall] Requesting media devices...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true
      });

      currentStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      return stream;
    } catch (error: any) {
      console.error("[VideoCall] Media device error:", error);
      setCameraError(error.message);
      throw error;
    }
  };

  const initializeCall = async () => {
    try {
      const stream = await initializeMediaDevices();

      const webrtc = new WebRTCConnection(
        roomId,
        (remoteStream) => {
          console.log("[VideoCall] Remote stream received");
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
        },
        (state) => {
          console.log("[VideoCall] Connection state:", state);
          setConnectionState(state);

          if (state === 'connected') {
            toast({
              title: "Conectado",
              description: "Conexión establecida exitosamente.",
            });
          } else if (state === 'failed' || state === 'disconnected') {
            toast({
              variant: "destructive",
              title: "Error de conexión",
              description: "Se perdió la conexión con el otro participante.",
            });
          }
        },
        (error) => {
          console.error("[VideoCall] Error:", error);
          toast({
            variant: "destructive",
            title: "Error en la llamada",
            description: error.message,
          });
        }
      );

      await webrtc.start(stream);
      webrtcRef.current = webrtc;

      // Set initial media states
      stream.getAudioTracks().forEach(track => {
        track.enabled = audioEnabled;
      });
      stream.getVideoTracks().forEach(track => {
        track.enabled = videoEnabled;
      });

    } catch (error) {
      console.error("[VideoCall] Initialization error:", error);
    }
  };

  useEffect(() => {
    initializeCall();

    return () => {
      stopCurrentStream();
      webrtcRef.current?.close();
    };
  }, [roomId]);

  const handleHangup = () => {
    stopCurrentStream();
    webrtcRef.current?.close();
    setLocation("/");
  };

  const handleAudioToggle = (enabled: boolean) => {
    setAudioEnabled(enabled);
    const stream = currentStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  };

  const handleVideoToggle = (enabled: boolean) => {
    setVideoEnabled(enabled);
    const stream = currentStreamRef.current;
    if (stream) {
      stream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
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
        audioEnabled={audioEnabled}
        onAudioToggle={handleAudioToggle}
        videoEnabled={videoEnabled}
        onVideoToggle={handleVideoToggle}
      />
    </div>
  );
}