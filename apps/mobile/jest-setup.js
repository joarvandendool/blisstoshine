// Expo's winter-runtime installeert een aantal globals als luie getters; door
// ze hier (binnen de testscope) één keer aan te raken zijn de modules geladen
// vóórdat jest buiten de scope raakt.
void globalThis.fetch;
void globalThis.__ExpoImportMetaRegistry;
void globalThis.TextDecoder;
void globalThis.TextDecoderStream;
void globalThis.TextEncoderStream;
void globalThis.URL;
void globalThis.URLSearchParams;
void globalThis.DOMException;
void globalThis.structuredClone;

// Reanimated 4 draait niet in jsdom/node — de officiële mock levert
// dezelfde API met statische waarden (animatie is in tests irrelevant).
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));
