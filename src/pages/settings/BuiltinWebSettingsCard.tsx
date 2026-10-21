import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Globe2, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  normalizeBuiltinWebConfig,
  WEB_PROVIDER_CATALOG,
  type BuiltinWebConfig,
  type ProviderId,
} from "@/lib/agent/tools/webProviderCatalog";
import { useBuiltinWebStore } from "@/store";

function moveProvider(
  providerOrder: ProviderId[],
  providerId: ProviderId,
  direction: -1 | 1
): ProviderId[] {
  const index = providerOrder.indexOf(providerId);
  const nextIndex = index + direction;
  if (
    providerId === "local" ||
    index < 0 ||
    nextIndex < 0 ||
    nextIndex >= providerOrder.length - 1
  ) {
    return providerOrder;
  }
  const next = [...providerOrder];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

function sameConfig(a: BuiltinWebConfig, b: BuiltinWebConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function BuiltinWebSettingsCard() {
  const { t } = useTranslation("pages");
  const config = useBuiltinWebStore((state) => state.config);
  const saveConfig = useBuiltinWebStore((state) => state.saveConfig);
  const [draft, setDraft] = useState<BuiltinWebConfig>(() =>
    normalizeBuiltinWebConfig(config)
  );

  useEffect(() => {
    setDraft(normalizeBuiltinWebConfig(config));
  }, [config]);

  const orderedProviders = draft.providerOrder
    .map((id) => WEB_PROVIDER_CATALOG.find((provider) => provider.id === id))
    .filter((provider): provider is (typeof WEB_PROVIDER_CATALOG)[number] =>
      Boolean(provider)
    );
  const dirty = !sameConfig(draft, config);

  return (
    <Card className="mt-5 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
          <Globe2 className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-heading-16">{t("builtin_web.title")}</h3>
          <p className="mt-1 text-copy-14 text-muted-foreground">
            {t("builtin_web.description")}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {orderedProviders.map((provider, index) => {
          const active = provider.requiredEnv.every(
            (requiredEnv) => Boolean(draft.credentials[requiredEnv.key]?.trim())
          );
          const isLocal = provider.id === "local";
          return (
            <div
              key={provider.id}
              className="grid gap-3 rounded-sm border border-border bg-background-secondary p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-label-14 font-medium">{provider.displayName}</h4>
                  {provider.capabilities.map((capability) => (
                    <Badge key={capability} variant="outline" className="rounded-sm">
                      {t(`builtin_web.capability.${capability}`)}
                    </Badge>
                  ))}
                  <Badge
                    variant={active ? "success" : "default"}
                    className="rounded-sm"
                  >
                    {t(active ? "builtin_web.active" : "builtin_web.inactive")}
                  </Badge>
                </div>
                <p className="mt-1 text-label-12 text-muted-foreground">
                  {t(provider.descriptionKey)}
                </p>
                {provider.requiredEnv.map((requiredEnv) => (
                  <label
                    key={requiredEnv.key}
                    className="mt-3 block text-label-13 font-medium text-foreground"
                  >
                    {t(requiredEnv.labelKey)}
                    <div className="relative mt-1.5">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="password"
                        value={draft.credentials[requiredEnv.key] ?? ""}
                        onChange={(event) => {
                          const credentials = { ...draft.credentials };
                          const value = event.target.value;
                          if (value) credentials[requiredEnv.key] = value;
                          else delete credentials[requiredEnv.key];
                          setDraft(
                            normalizeBuiltinWebConfig({
                              ...draft,
                              credentials,
                            })
                          );
                        }}
                        className="pl-9"
                        autoComplete="off"
                      />
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex items-center gap-1 self-start">
                {!isLocal && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title={t("builtin_web.move_up")}
                      disabled={index === 0}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          providerOrder: moveProvider(
                            current.providerOrder,
                            provider.id,
                            -1
                          ),
                        }))
                      }
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title={t("builtin_web.move_down")}
                      disabled={index === orderedProviders.length - 2}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          providerOrder: moveProvider(
                            current.providerOrder,
                            provider.id,
                            1
                          ),
                        }))
                      }
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-label-12 text-muted-foreground">
        {t("builtin_web.storage_notice")}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={!dirty}
          onClick={() => setDraft(normalizeBuiltinWebConfig(config))}
        >
          {t("cancel", { ns: "common" })}
        </Button>
        <Button
          type="button"
          disabled={!dirty}
          onClick={() => saveConfig(draft)}
        >
          {t("save", { ns: "common" })}
        </Button>
      </div>
    </Card>
  );
}
