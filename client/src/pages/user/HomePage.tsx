import { UserLayout } from "../../components/layout/UserLayout";
import { ChatInterface } from "../../components/ui/ChatInterface";

export function HomePage() {
  return (
    <UserLayout>
      <ChatInterface />
    </UserLayout>
  );
}
