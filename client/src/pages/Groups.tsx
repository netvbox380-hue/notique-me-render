import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogContentScrollable,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Users as UsersIcon, Edit2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export default function Groups() {
  const utils = trpc.useUtils();

  const groupsQuery = trpc.groups.list.useQuery({ limit: 200 });
  const usersQuery = trpc.tenant.listMyUsers.useQuery();

  const groups = groupsQuery.data?.data ?? [];
  // ✅ tenant.listMyUsers retorna array direto
  const users = usersQuery.data ?? [];

  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const [form, setForm] = useState({ name: "", description: "" });

  const createMutation = trpc.groups.create.useMutation({
    onSuccess: async () => {
      toast.success("Grupo criado");
      setOpenCreate(false);
      setForm({ name: "", description: "" });
      await utils.groups.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.groups.update.useMutation({
    onSuccess: async () => {
      toast.success("Grupo atualizado");
      setEditing(null);
      await utils.groups.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.groups.delete.useMutation({
    onSuccess: async () => {
      toast.success("Grupo removido");
      await utils.groups.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const [membersGroup, setMembersGroup] = useState<any | null>(null);

  const membersQuery = trpc.groups.getMembers.useQuery(
    { groupId: membersGroup?.id ?? 0 },
    { enabled: Boolean(membersGroup?.id) }
  );

  const memberIds = useMemo(
    () => new Set<number>(membersQuery.data?.userIds ?? []),
    [membersQuery.data]
  );
  const [memberDraft, setMemberDraft] = useState<number[] | null>(null);

  const setMembersMutation = trpc.groups.setMembers.useMutation({
    onError: (e) => toast.error(e.message),
  });

  const openMembers = (g: any) => {
    setMembersGroup(g);
    setMemberDraft(null);
  };

  const effectiveDraft = memberDraft !== null ? new Set(memberDraft) : memberIds;

  const toggleMember = (id: number) => {
    setMemberDraft((prev) => {
      const base = prev !== null ? new Set(prev) : new Set(memberIds);
      if (base.has(id)) base.delete(id);
      else base.add(id);
      return Array.from(base);
    });
  };

  useEffect(() => {
    if (!membersGroup) return;
    setMemberDraft(null);
  }, [membersGroup?.id]);

  const saveMembers = async () => {
    if (!membersGroup) return;

    const payload = memberDraft !== null ? memberDraft : Array.from(memberIds);

    await setMembersMutation.mutateAsync({
      groupId: membersGroup.id,
      memberUserIds: payload,
    });

    toast.success("Membros atualizados");

    // ✅ garante UI consistente em reaberturas
    await utils.groups.getMembers.invalidate({ groupId: membersGroup.id });
    await utils.groups.list.invalidate();

    // ✅ limpa draft pós-save
    setMemberDraft(null);
  };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-8">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold">Grupos</h1>
            <p className="text-sm text-muted-foreground">Crie grupos e gerencie membros.</p>
          </div>

          <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" /> Novo grupo
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Novo grupo</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!form.name.trim()) return toast.error("Informe o nome");
                  createMutation.mutate({
                    name: form.name.trim(),
                    description: form.description.trim() || undefined,
                  });
                }}
              >
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Descrição (opcional)</Label>
                  <Textarea
                    value={form.description}
                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Salvando..." : "Criar"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-3">
          {groups.map((g: any) => (
            <div
              key={g.id}
              className="rounded-2xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <UsersIcon className="w-4 h-4 text-muted-foreground" />
                  <div className="font-medium truncate">{g.name}</div>
                </div>
                {g.description ? (
                  <div className="text-sm text-muted-foreground mt-1 line-clamp-2">{g.description}</div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="gap-2" onClick={() => openMembers(g)}>
                  <UsersIcon className="w-4 h-4" /> Membros
                </Button>

                <Dialog
                  open={editing?.id === g.id}
                  onOpenChange={(v) => (!v ? setEditing(null) : setEditing(g))}
                >
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={() => {
                        setEditing(g);
                        setForm({ name: g.name ?? "", description: g.description ?? "" });
                      }}
                    >
                      <Edit2 className="w-4 h-4" /> Editar
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Editar grupo</DialogTitle>
                    </DialogHeader>
                    <form
                      className="space-y-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!editing) return;
                        updateMutation.mutate({
                          id: editing.id,
                          name: form.name.trim() || undefined,
                          description: form.description.trim() || undefined,
                        });
                      }}
                    >
                      <div className="space-y-2">
                        <Label>Nome</Label>
                        <Input
                          value={form.name}
                          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Descrição</Label>
                        <Textarea
                          value={form.description}
                          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                        />
                      </div>
                      <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
                        {updateMutation.isPending ? "Salvando..." : "Salvar"}
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>

                <Button
                  variant="destructive"
                  className="gap-2"
                  onClick={() => {
                    if (!confirm("Remover este grupo?")) return;
                    deleteMutation.mutate({ id: g.id });
                  }}
                >
                  <Trash2 className="w-4 h-4" /> Remover
                </Button>
              </div>
            </div>
          ))}

          {!groups.length && !groupsQuery.isLoading ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Nenhum grupo criado.
            </div>
          ) : null}
        </div>

        <Dialog open={Boolean(membersGroup)} onOpenChange={(v) => (!v ? setMembersGroup(null) : null)}>
          <DialogContentScrollable className="w-[calc(100vw-0.75rem)] max-w-[96vw] sm:max-w-xl p-0 gap-0 rounded-2xl overflow-hidden border border-border bg-card shadow-2xl top-[max(0.5rem,env(safe-area-inset-top))] bottom-[max(0.5rem,env(safe-area-inset-bottom))] h-auto max-h-none translate-y-0 sm:top-[50%] sm:bottom-auto sm:h-auto sm:max-h-[90vh] sm:translate-y-[-50%]">
            <DialogHeader className="shrink-0 px-4 pt-5 pb-3 sm:px-6 sm:pt-6 border-b border-border/60 bg-card">
              <DialogTitle className="pr-8 text-left">Membros — {membersGroup?.name}</DialogTitle>
              <div className="text-sm text-muted-foreground text-left">
                Selecione os usuários que farão parte do grupo.
              </div>
            </DialogHeader>

            <DialogBody className="min-h-0 flex-1 overflow-hidden px-3 py-3 sm:px-4 sm:py-4 bg-card">
              <div className="h-full rounded-2xl border border-border bg-background/60 overflow-y-auto overscroll-contain sm:h-auto sm:max-h-[58vh]">
                <div className="p-3 space-y-2 sm:p-4">
                  {membersQuery.isLoading ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">Carregando membros...</div>
                  ) : (
                    <>
                      {users.map((u: any) => (
                        <label
                          key={u.id}
                          className="flex items-start gap-3 rounded-xl px-2 py-3 sm:px-3 hover:bg-muted/40 transition-colors"
                        >
                          <Checkbox
                            className="mt-1 shrink-0"
                            checked={effectiveDraft.has(u.id)}
                            onCheckedChange={() => toggleMember(u.id)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium leading-tight break-words">{u.name || u.email || u.openId}</div>
                            <div className="text-xs text-muted-foreground break-all mt-1">{u.email || u.openId}</div>
                          </div>
                        </label>
                      ))}
                      {!users.length && !usersQuery.isLoading ? (
                        <div className="p-6 text-center text-sm text-muted-foreground">Nenhum usuário no tenant.</div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </DialogBody>

            <div className="shrink-0 mt-0 grid grid-cols-1 sm:grid-cols-2 gap-2 px-3 py-3 sm:px-4 sm:py-4 pb-[max(0.9rem,calc(env(safe-area-inset-bottom)+0.75rem))] border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/90 shadow-[0_-10px_30px_-24px_rgba(0,0,0,0.85)]">
              <Button
                variant="secondary"
                className="h-11 w-full"
                onClick={() => setMembersGroup(null)}
              >
                Fechar
              </Button>
              <Button
                className="h-11 w-full"
                onClick={saveMembers}
                disabled={setMembersMutation.isPending}
              >
                {setMembersMutation.isPending ? "Salvando..." : "Salvar membros"}
              </Button>
            </div>
          </DialogContentScrollable>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
