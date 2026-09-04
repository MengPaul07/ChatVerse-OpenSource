import WorldStudioFeature from "../features/studio/WorldStudioFeature";

export default function WorldStudioPage({
  defaultProfile = "world_story",
}: {
  defaultProfile?: "world_story" | "group_chat";
}) {
  return <WorldStudioFeature defaultProfile={defaultProfile} />;
}
