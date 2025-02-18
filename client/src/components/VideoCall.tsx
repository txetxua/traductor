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

  // Refs para los timers de limpieza de subtítulos
  const localTimerRef = useRef<NodeJS.Timeout>();
  const remoteTimerRef = useRef<NodeJS.Timeout>();

  const clearTranscriptAfterDelay = (
    isLocal: boolean,
    delay: number = 5000
  ) => {
    const timerRef = isLocal ? localTimerRef : remoteTimerRef;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      if (isLocal) {
        setLocalTranscript("");
      } else {
        setRemoteTranscript("");
      }
    }, delay);
  };

  useEffect(() => {
    const handleSpeechResult = (text: string, isLocal: boolean) => {
      console.log("[VideoCall] Recibido texto:", text, "isLocal:", isLocal);

      // Si es un mensaje local (el que hablamos)
      if (isLocal) {
        setLocalTranscript(text);
      } 
      // Si es un mensaje remoto (traducido del otro participante)
      else {
        setRemoteTranscript(text);
      }

      // Programar la limpieza del mensaje correspondiente
      clearTranscriptAfterDelay(isLocal);
    };

    const speech = new SpeechHandler(
      roomId,
      language,
      handleSpeechResult,
      (error: Error) => {
        console.error("[VideoCall] Error en SpeechHandler:", error);
        toast({
          variant: "destructive",
          title: "Error en el reconocimiento de voz",
          description: error.message,
        });
      }
    );

    const handleError = (error: Error) => {
      console.error("[VideoCall] Error:", error);
      if (error.name === 'NotAllowedError') {
        setCameraError('No se ha dado permiso para acceder a la cámara');
      } else if (error.name === 'NotFoundError') {
        setCameraError('No se encontró ninguna cámara');
      } else {
        setCameraError(error.message);
      }

      toast({
        variant: "destructive",
        title: "Error en la llamada",
        description: error.message,
      });
    };

    async function initializeCall() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = devices.some(device => device.kind === 'videoinput');
        const hasMicrophone = devices.some(device => device.kind === 'audioinput');

        if (!hasCamera && videoEnabled) {
          throw new Error('No se detectó ninguna cámara');
        }

        if (!hasMicrophone) {
          throw new Error('No se detectó ningún micrófono');
        }

        const webrtc = new WebRTCConnection(
          roomId,
          (stream) => {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = stream;
              remoteVideoRef.current.play().catch(console.error);
            }
          },
          (state) => {
            console.log("[VideoCall] Estado de conexión:", state);
            setConnectionState(state);

            if (state === 'failed' || state === 'disconnected') {
              toast({
                variant: "destructive",
                title: "Error de conexión",
                description: "Se perdió la conexión con el otro participante. Intentando reconectar...",
              });
            } else if (state === 'connected') {
              toast({
                title: "Conectado",
                description: "La conexión se ha establecido correctamente.",
              });
            }
          },
          handleError
        );

        const localStream = await webrtc.start(videoEnabled);

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
          localVideoRef.current.play().catch(console.error);
        }

        localStream.getAudioTracks().forEach(track => {
          track.enabled = audioEnabled;
        });
        localStream.getVideoTracks().forEach(track => {
          track.enabled = videoEnabled;
        });

        speech.start();

        webrtcRef.current = webrtc;
        speechRef.current = speech;
      } catch (error) {
        handleError(error as Error);
      }
    }

    initializeCall();

    return () => {
      // Limpiar los timers al desmontar
      if (localTimerRef.current) {
        clearTimeout(localTimerRef.current);
      }
      if (remoteTimerRef.current) {
        clearTimeout(remoteTimerRef.current);
      }
      webrtcRef.current?.close();
      speechRef.current?.stop();
    };
  }, [roomId, language, toast, videoEnabled, audioEnabled]);

  const handleHangup = () => {
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
        />

        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
            <div className="bg-destructive p-4 rounded-lg">
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
          />
        </div>

        <SubtitlesConfig onChange={setSubtitlesConfig} />

        {/* Contenedor de subtítulos */}
        <div className="absolute bottom-24 left-0 right-0 flex flex-col items-center gap-4 pointer-events-none">
          {localTranscript && (
            <Subtitles
              transcript={localTranscript}
              config={{...subtitlesConfig, color: "yellow"}} // Color amarillo para mensajes locales
            />
          )}
          {remoteTranscript && (
            <Subtitles
              transcript={remoteTranscript}
              config={subtitlesConfig} // Color normal para mensajes traducidos
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