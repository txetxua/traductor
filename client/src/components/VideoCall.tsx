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

  const [transcript, setTranscript] = useState("");
  const [translated, setTranslated] = useState("");
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>();
  const [subtitlesConfig, setSubtitlesConfig] = useState<SubtitlesConfigType>(DEFAULT_SUBTITLES_CONFIG);
  const [cameraError, setCameraError] = useState<string>();
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [isLocalUser, setIsLocalUser] = useState(true); // Added state to track user role

  useEffect(() => {
    console.log("Configurando reconocimiento de voz para idioma:", language);

    const handleSpeechResult = (text: string, translatedText: string) => {
      console.log("Texto recibido:", text);
      console.log("Traducción recibida:", translatedText);
      setTranscript(text);
      setTranslated(translatedText);
    };

    const speech = new SpeechHandler(
      roomId,
      language,
      handleSpeechResult
    );

    const handleError = (error: Error) => {
      console.error("Error en llamada:", error);
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
        console.log("Iniciando llamada para room:", roomId);

        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = devices.some(device => device.kind === 'videoinput');
        const hasMicrophone = devices.some(device => device.kind === 'audioinput');

        console.log("Dispositivos disponibles:", {
          camera: hasCamera,
          microphone: hasMicrophone
        });

        if (!hasCamera && videoEnabled) {
          throw new Error('No se detectó ninguna cámara');
        }

        if (!hasMicrophone) {
          throw new Error('No se detectó ningún micrófono');
        }

        const webrtc = new WebRTCConnection(
          roomId,
          (stream) => {
            console.log("Stream remoto recibido:", {
              hasVideo: stream.getVideoTracks().length > 0,
              hasAudio: stream.getAudioTracks().length > 0
            });
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = stream;
              remoteVideoRef.current.play().catch(console.error);
            }
            setIsLocalUser(false); // Set to false when remote stream is received
          },
          (state) => {
            console.log("Estado de conexión cambiado a:", state);
            setConnectionState(state);
          },
          handleError
        );

        console.log("Iniciando conexión WebRTC...");
        const localStream = await webrtc.start(videoEnabled);
        console.log("Stream local obtenido:", {
          hasVideo: localStream.getVideoTracks().length > 0,
          hasAudio: localStream.getAudioTracks().length > 0
        });

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
          localVideoRef.current.play().catch(console.error);
        }

        // Configurar estado inicial de audio/video
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

        <Subtitles
          transcript={isLocalUser ? "" : transcript}  // Only show transcript for remote user
          translated={translated}
          config={subtitlesConfig}
        />
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