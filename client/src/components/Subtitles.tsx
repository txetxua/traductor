import { type SubtitlesConfig } from "./SubtitlesConfig";

interface Props {
  transcript: string;
  translated: string;
  config: SubtitlesConfig;
}

export default function Subtitles({ transcript, translated, config }: Props) {
  if (!transcript && !translated) return null;

  const subtitleStyle = {
    fontSize: `${config.fontSize}px`,
    fontFamily: config.fontFamily,
    color: config.color,
    textShadow: "2px 2px 4px rgba(0,0,0,0.5)",
    maxWidth: "80%", 
    margin: "0 auto"  
  };

  return (
    <div className="absolute bottom-24 left-0 right-0 flex flex-col items-center gap-1 pointer-events-none">
      {transcript && (
        <div 
          className="px-3 py-1 rounded-lg font-semibold text-center"
          style={subtitleStyle}
        >
          {transcript}
        </div>
      )}
      {translated && (
        <div 
          className="px-3 py-1 rounded-lg font-semibold text-center"
          style={subtitleStyle}
        >
          {translated}
        </div>
      )}
    </div>
  );
}