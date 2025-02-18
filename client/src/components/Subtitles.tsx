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
    textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
    maxWidth: "80%",
    margin: "0 auto",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    padding: "8px 12px",
    borderRadius: "4px",
    lineHeight: "1.5"
  };

  return (
    <div className="absolute bottom-24 left-0 right-0 flex flex-col items-center gap-4 pointer-events-none">
      {transcript && (
        <div 
          className="text-center"
          style={subtitleStyle}
        >
          {transcript}
        </div>
      )}
      {translated && transcript !== translated && (
        <div 
          className="text-center opacity-90"
          style={{
            ...subtitleStyle,
            fontSize: `${config.fontSize * 0.9}px`,
            backgroundColor: "rgba(0, 0, 0, 0.4)"
          }}
        >
          {translated}
        </div>
      )}
    </div>
  );
}