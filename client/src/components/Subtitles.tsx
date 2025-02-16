interface Props {
  transcript: string;
  translated: string;
}

export default function Subtitles({ transcript, translated }: Props) {
  if (!transcript && !translated) return null;

  return (
    <div className="absolute bottom-28 left-0 right-0 flex flex-col items-center gap-2 pointer-events-none">
      {transcript && (
        <div className="px-4 py-2 rounded-lg text-2xl font-semibold text-white text-center">
          {transcript}
        </div>
      )}
      {translated && (
        <div className="px-4 py-2 rounded-lg text-2xl font-semibold text-white text-center">
          {translated}
        </div>
      )}
    </div>
  );
}
