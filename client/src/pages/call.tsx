import { useEffect, useState } from "react";
import { useParams } from "wouter";
import VideoCall from "@/components/VideoCall";
import { type Language } from "@shared/schema";

export default function Call() {
  const { roomId } = useParams();
  const [language, setLanguage] = useState<Language>("es");
  
  if (!roomId) return null;

  return (
    <div className="min-h-screen bg-background">
      <VideoCall 
        roomId={roomId}
        language={language}
        onLanguageChange={setLanguage}
      />
    </div>
  );
}
