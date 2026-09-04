export interface CharacterStatePatch {
  availability?: "available" | "away" | "unavailable";
  attention?: "active" | "lurking" | "distracted";
  mood?: string;
  intent?: string;
  note?: string;
  reason?: string;
}
