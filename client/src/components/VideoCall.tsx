import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { WebRTCConnection } from "@/lib/webrtc";
import { SpeechHandler } from "@/lib/speech";
import { type Language } from "@shared/schema";
import CallControls from "@/components/CallControls";
import Subtitles from "@/components/Subtitles";
import SubtitlesConfig from "@/components/SubtitlesConfig";
import { type SubtitlesConfig as SubtitlesConfigType } from "./SubtitlesConfig";
import { useToast } from "@/hooks/use-toast";

interface Props {
  roomId: string;
  language: Language;
  onLanguageChange: (lang: Language) => void;
}

const DEFAULT_SUBTITLES_CONFIG: SubtitlesConfigType = {
  fontSize: 24,
  fontFamily: "sans",
  color: "white",
};

export default function VideoCall({ roomId, language, onLanguageChange }: Props) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const webrtcRef = useRef<WebRTCConnection>();
  const speechRef = useRef<SpeechHandler>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [localTranscript, setLocalTranscript] = useState("");
  const [remoteTranscript, setRemoteTranscript] = useState("");
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>();
  const [subtitlesConfig, setSubtitlesConfig] = useState<SubtitlesConfigType>(DEFAULT_SUBTITLES_CONFIG);
  const [cameraError, setCameraError] = useState<string>();
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);

  const localTimerRef = useRef<NodeJS.Timeout>();
  const remoteTimerRef = useRef<NodeJS.Timeout>();
  const currentStreamRef = useRef<MediaStream | null>(null);

  const clearTranscriptAfterDelay = (isLocal: boolean, delay: number = 5000) => {
    const timerRef = isLocal ? localTimerRef : remoteTimerRef;
    const setTranscript = isLocal ? setLocalTranscript : setRemoteTranscript;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setTranscript("");
    }, delay);
  };

  const handleSpeechResult = (text: string, isLocal: boolean) => {
    console.log(`[VideoCall] ${isLocal ? 'Local' : 'Remote'} transcript received:`, text);
    if (isLocal) {
      setLocalTranscript(text);
      clearTranscriptAfterDelay(true);
    } else {
      setRemoteTranscript(text);
      clearTranscriptAfterDelay(false);
    }
  };

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
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      });

      currentStreamRef.current = stream;
      console.log("[VideoCall] Media stream obtained");

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play().catch(console.error);
      }

      return stream;
    } catch (error: any) {
      console.error("[VideoCall] Media device error:", error);
      let errorMessage = error.message;

      // Handle specific permission errors
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Por favor, permite el acceso a la cámara y el micrófono para continuar';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'No se encontró cámara o micrófono en tu dispositivo';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'Tu cámara o micrófono está siendo usado por otra aplicación';
      }

      setCameraError(errorMessage);
      throw error;
    }
  };

  const initializeCall = async () => {
    try {
      const stream = await initializeMediaDevices();

      // Initialize WebRTC
      const webrtc = new WebRTCConnection(
        roomId,
        (remoteStream) => {
          console.log("[VideoCall] Remote stream received");
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
            remoteVideoRef.current.play().catch(console.error);
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

      // Initialize speech recognition
      const speech = new SpeechHandler(
        roomId,
        language,
        handleSpeechResult,
        (error) => {
          console.error("[VideoCall] Speech error:", error);
          toast({
            variant: "destructive",
            title: "Error en reconocimiento de voz",
            description: error.message,
          });
        }
      );
      speech.start();
      speechRef.current = speech;

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
      if (localTimerRef.current) clearTimeout(localTimerRef.current);
      if (remoteTimerRef.current) clearTimeout(remoteTimerRef.current);
      webrtcRef.current?.close();
      speechRef.current?.stop();
    };
  }, [roomId, language, toast, audioEnabled, videoEnabled]);

  const handleHangup = () => {
    stopCurrentStream();
    webrtcRef.current?.close();
    speechRef.current?.stop();
    setLocation("/");
  };

  const handleAudioToggle = (enabled: boolean) => {
    setAudioEnabled(enabled);
    const stream = localVideoRef.current?.srcObject as MediaStream;
    if (stream) {
      stream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  };

  const handleVideoToggle = (enabled: boolean) => {
    setVideoEnabled(enabled);
    const stream = localVideoRef.current?.srcObject as MediaStream;
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

        <SubtitlesConfig onChange={setSubtitlesConfig} />

        <div className="absolute bottom-24 left-0 right-0 flex flex-col items-center gap-4 pointer-events-none" aria-live="polite">
          {localTranscript && (
            <Subtitles
              transcript={localTranscript}
              config={{
                ...subtitlesConfig,
                color: "rgba(255, 255, 255, 0.7)"
              }}
              aria-label="Subtítulos de tu voz"
            />
          )}
          {remoteTranscript && (
            <Subtitles
              transcript={remoteTranscript}
              config={subtitlesConfig}
              aria-label="Subtítulos del participante remoto"
            />
          )}
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