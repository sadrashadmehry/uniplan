import { getChatGPTUser } from "./chatgpt-auth";
import { SchedulePlanner } from "./SchedulePlanner";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <SchedulePlanner
      user={
        user
          ? {
              displayName: user.displayName,
              email: user.email,
            }
          : null
      }
    />
  );
}
