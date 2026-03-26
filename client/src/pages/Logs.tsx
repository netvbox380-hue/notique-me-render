import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

function formatDateTime(d?: string | Date | null) {
  if (!d) return "-";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
}

export default function Logs() {
  const [page, setPage] = useState(0);
  const limit = 50;

  const input = useMemo(() => ({ limit, offset: page * limit }), [page]);
  const { data, isLoading, error } = trpc.tenant.listLogs.useQuery(input);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <DashboardLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mono mb-2">LOGS</h1>
          <div className="h-1 w-32 bg-primary"></div>
          <p className="text-muted-foreground mt-4">Registros do tenant (auditoria).</p>
        </div>

        <div className="brutalist-card p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="text-sm text-muted-foreground">
              {isLoading ? "Carregando…" : `Total: ${total}`}
              {error ? " • Erro ao carregar" : ""}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Anterior
              </Button>
              <div className="text-xs text-muted-foreground">
                Página {page + 1} / {totalPages}
              </div>
              <Button
                variant="secondary"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border">
                  <th className="py-2 pr-3">Quando</th>
                  <th className="py-2 pr-3">Ação</th>
                  <th className="py-2 pr-3">Entidade</th>
                  <th className="py-2 pr-3">IDs</th>
                  <th className="py-2">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {(data?.data ?? []).map((l: any) => (
                  <tr key={l.id} className="border-b border-border/50 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {formatDateTime(l.createdAt)}
                    </td>
                    <td className="py-2 pr-3 font-semibold">{l.action}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {l.entityType ?? "-"}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                      <div>log#{l.id}</div>
                      {l.entityId ? <div>ent#{l.entityId}</div> : null}
                      {l.userId ? <div>user#{l.userId}</div> : null}
                      {l.createdByAdminId ? <div>admin#{l.createdByAdminId}</div> : null}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      <div className="line-clamp-3">{l.details ?? "-"}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!isLoading && (data?.data?.length ?? 0) === 0 && (
              <p className="text-muted-foreground text-center py-8">Nenhum log ainda.</p>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
