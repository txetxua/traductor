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
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;

  const localTimerRef = useRef<NodeJS.Timeout>();
  const remoteTimerRef = useRef<NodeJS.Timeout>();

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

  useEffect(() => {
    let mounted = true;

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

    const handleError = async (error: Error) => {
      if (!mounted) return;
      console.error("[VideoCall] Error:", error);

      if (error.name === 'NotAllowedError') {
        setCameraError('Por favor, permite el acceso a la cámara y el micrófono para continuar');
      } else if (error.name === 'NotFoundError') {
        setCameraError('No se encontró cámara o micrófono en tu dispositivo');
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        setCameraError('Tu cámara o micrófono está siendo usado por otra aplicación');
      } else {
        setCameraError(error.message);
      }

      if (retryCount < maxRetries &&
          (error.name === 'NotReadableError' ||
           error.name === 'TrackStartError' ||
           error.message.includes('failed to connect'))) {
        setRetryCount(prev => prev + 1);
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (mounted) {
          initializeCall();
        }
      } else {
        toast({
          variant: "destructive",
          title: "Error en la llamada",
          description: error.message,
        });
      }
    };

    async function initializeCall() {
      if (!mounted) return;
      try {
        setCameraError(undefined);

        // Liberar tracks existentes
        if (localVideoRef.current?.srcObject) {
          const stream = localVideoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
        }

        console.log("[VideoCall] Solicitando acceso a dispositivos multimedia...");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true, // Siempre solicitar video primero
          audio: true
        }).catch((error) => {
          console.error("[VideoCall] Error obteniendo dispositivos:", error);
          setCameraError(error.message);
          throw error;
        });

        console.log("[VideoCall] Stream multimedia obtenido");

        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        // Configurar video local
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          await localVideoRef.current.play().catch(console.error);
        }

        // Inicializar WebRTC con el stream
        const webrtc = new WebRTCConnection(
          roomId,
          (remoteStream) => {
            if (!mounted) return;
            console.log("[VideoCall] Stream remoto recibido");
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream;
              remoteVideoRef.current.play().catch(console.error);
            }
          },
          (state) => {
            if (!mounted) return;
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
                description: "Conexión establecida exitosamente.",
              });
              setRetryCount(0);
            }
          },
          handleError
        );

        await webrtc.start(stream);
        console.log("[VideoCall] Conexión WebRTC iniciada");

        // Configurar estado inicial de audio/video
        stream.getAudioTracks().forEach(track => {
          track.enabled = audioEnabled;
        });
        stream.getVideoTracks().forEach(track => {
          track.enabled = videoEnabled;
        });

        // Iniciar reconocimiento de voz
        const speech = new SpeechHandler(
          roomId,
          language,
          handleSpeechResult,
          (error: Error) => {
            if (!mounted) return;
            console.error("[VideoCall] Error en reconocimiento de voz:", error);
            toast({
              variant: "destructive",
              title: "Error en reconocimiento de voz",
              description: error.message,
            });
          }
        );
        speech.start();

        webrtcRef.current = webrtc;
        speechRef.current = speech;

      } catch (error) {
        console.error("[VideoCall] Error de inicialización:", error);
        handleError(error as Error);
      }
    }

    initializeCall();

    return () => {
      mounted = false;
      if (localTimerRef.current) {
        clearTimeout(localTimerRef.current);
      }
      if (remoteTimerRef.current) {
        clearTimeout(remoteTimerRef.current);
      }
      if (localVideoRef.current?.srcObject) {
        const stream = localVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
      webrtcRef.current?.close();
      speechRef.current?.stop();
    };
  }, [roomId, language, toast, videoEnabled, audioEnabled, retryCount]);

  const handleHangup = () => {
    if (localVideoRef.current?.srcObject) {
      const stream = localVideoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
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

        <div className="absolute bottom-24 left-0 right-0 flex flex-col items-center gap-4 pointer-events-none">
          {localTranscript && (
            <Subtitles
              transcript={localTranscript}
              config={{
                ...subtitlesConfig,
                color: "rgba(255, 255, 255, 0.7)" // Subtítulos locales más transparentes
              }}
            />
          )}
          {remoteTranscript && (
            <Subtitles
              transcript={remoteTranscript}
              config={subtitlesConfig}
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