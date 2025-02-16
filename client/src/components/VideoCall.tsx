import { useEffect, useRef, useState } from "react";
import { WebRTCConnection } from "@/lib/webrtc";
import { SpeechHandler } from "@/lib/speech";
import { type Language } from "@shared/schema";
import CallControls from "./CallControls";
import Subtitles from "./Subtitles";

interface Props {
  roomId: string;
  language: Language;
  onLanguageChange: (lang: Language) => void;
}

export default function VideoCall({ roomId, language, onLanguageChange }: Props) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const webrtcRef = useRef<WebRTCConnection>();
  const speechRef = useRef<SpeechHandler>();

  const [transcript, setTranscript] = useState("");
  const [translated, setTranslated] = useState("");
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>();

  useEffect(() => {
    const webrtc = new WebRTCConnection(
      roomId,
      (stream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      },
      setConnectionState
    );

    const speech = new SpeechHandler(
      roomId,
      language,
      (text, translated) => {
        setTranscript(text);
        setTranslated(translated);
      }
    );

    webrtc.start(true).then(stream => {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      speech.start();
    });

    webrtcRef.current = webrtc;
    speechRef.current = speech;

    return () => {
      webrtc.close();
      speech.stop();
    };
  }, [roomId, language]);

  return (
    <div className="h-screen flex flex-col">
      <div className="flex-1 relative bg-background">
        {/* Video remoto a pantalla completa */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Video local en esquina superior derecha */}
        <div className="absolute top-4 right-4 w-48 aspect-video">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover rounded-lg shadow-lg"
          />
        </div>

        <Subtitles 
          transcript={transcript}
          translated={translated}
        />
      </div>

      <CallControls 
        language={language}
        onLanguageChange={onLanguageChange}
        connectionState={connectionState}
      />
    </div>
  );
}