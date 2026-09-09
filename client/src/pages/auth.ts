import { api } from "../api.ts";
import { renderPinPad } from "../components/pinpad.ts";
import { clear } from "../dom.ts";

export function renderAuthPage(container: HTMLElement, needsSetup: boolean): void {
  clear(container);
  const inner = document.createElement("div");
  container.append(inner);
  const onDone = needsSetup
    ? async (pin: string) => {
        await api.setup(pin);
        location.reload();
      }
    : async (pin: string) => {
        await api.login(pin);
        location.reload();
      };
  renderPinPad(inner, {
    title: needsSetup ? "CREATE YOUR PIN" : "ENTER PIN",
    subtitle: needsSetup
      ? "4-6 digits. You'll need it every time you open the tracker."
      : "Welcome back, Jude",
    onDone,
  });
}
