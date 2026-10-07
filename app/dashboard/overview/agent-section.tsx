"use client";

// ---------------------------------------------------------------------------
// Agents Performance — anti-theft roster.
//
// The grid deliberately exposes ONLY a face and a name: no numbers, no contact
// details. Everything else sits behind the secure detail panel that an admin has
// to open deliberately (so a quick screenshot of the dashboard leaks nothing).
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Crown, ImagePlus, Lock, Pencil, Search, ShieldCheck, Upload, X } from "lucide-react";

import { updateMyEmployeeProfile } from "@/app/actions/profile";
import { createClient } from "@/lib/supabase/client";
import { buttonVariants, Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import type { EmployeeDirectoryEntry } from "@/app/actions/leads";

import {
  buildAgentCards,
  findTopPerformer,
  formatNumber,
  formatRate,
  type AgentCard,
  type AgentStat,
} from "./analytics";

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</span>
      <span className="text-right text-sm font-medium text-slate-800">{value && value.trim() ? value : "—"}</span>
    </div>
  );
}

function PerformanceChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 text-center ${tone}`}>
      <p className="text-lg leading-none font-semibold">{formatNumber(value)}</p>
      <p className="mt-1 text-[11px] font-medium tracking-wide uppercase opacity-80">{label}</p>
    </div>
  );
}

function SelfProfileEditor({
  profile,
  onSaved,
}: {
  profile: EmployeeDirectoryEntry;
  onSaved: (profile: EmployeeDirectoryEntry) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [gender, setGender] = useState(profile.gender ?? "");
  const [bloodGroup, setBloodGroup] = useState(profile.blood_group ?? "");
  const [emergencyContact, setEmergencyContact] = useState(profile.emergency_contact ?? "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState(profile.photo_url);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    return () => {
      if (photoPreview?.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
    }
  }, [photoPreview]);

  function choosePhoto(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.add({ title: "Unsupported image", description: "Choose a JPG, PNG or WebP image.", type: "error" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.add({ title: "Image is too large", description: "Choose an image smaller than 5 MB.", type: "error" });
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);

    const supabase = createClient();
    let uploadedPath: string | null = null;
    let photoUrl = profile.photo_url;
    try {
      if (photoFile) {
        const extension = photoFile.type === "image/jpeg" ? "jpg" : photoFile.type.split("/")[1];
        uploadedPath = `${profile.id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("employee-avatars")
          .upload(uploadedPath, photoFile, {
            cacheControl: "3600",
            contentType: photoFile.type,
            upsert: false,
          });
        if (uploadError) {
          toast.add({ title: "Unable to upload photo", description: uploadError.message, type: "error" });
          setIsSaving(false);
          return;
        }
        photoUrl = supabase.storage.from("employee-avatars").getPublicUrl(uploadedPath).data.publicUrl;
      }

      const response = await updateMyEmployeeProfile({
        name,
        phone,
        email,
        gender,
        blood_group: bloodGroup,
        emergency_contact: emergencyContact,
        photo_url: photoUrl,
      });
      if (!response.success) {
        if (uploadedPath) {
          const { error: cleanupError } = await supabase.storage
            .from("employee-avatars")
            .remove([uploadedPath]);
          if (cleanupError) {
            console.error("[profile] Could not remove an unused uploaded avatar:", cleanupError.message);
          }
        }
        toast.add({ title: "Unable to save profile", description: response.error, type: "error" });
        setIsSaving(false);
        return;
      }

      setPhotoFile(null);
      setName(response.profile.name);
      setPhone(response.profile.phone ?? "");
      setEmail(response.profile.email ?? "");
      setGender(response.profile.gender ?? "");
      setBloodGroup(response.profile.blood_group ?? "");
      setEmergencyContact(response.profile.emergency_contact ?? "");
      setPhotoPreview(response.profile.photo_url);
      onSaved(response.profile);
      toast.add({ title: "Profile updated", description: "Your profile details were saved.", type: "success" });
    } catch (error) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage
          .from("employee-avatars")
          .remove([uploadedPath]);
        if (cleanupError) {
          console.error("[profile] Could not remove an unused uploaded avatar:", cleanupError.message);
        }
      }
      toast.add({
        title: "Unable to save profile",
        description: error instanceof Error ? error.message : "Please try again.",
        type: "error",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSave(event)} className="space-y-4 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Your profile details</h3>
        <p className="mt-1 text-xs text-slate-500">
          Only you and authorized admins/managers can view these HR details.
        </p>
      </div>
      <div className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoPreview} alt="Your profile" className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-6 text-slate-400" aria-hidden="true" />
          )}
        </span>
        <div className="space-y-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              choosePhoto(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={isSaving}>
            <Upload aria-hidden="true" /> Upload photo
          </Button>
          <p className="text-[11px] text-slate-500">JPG, PNG or WebP. Maximum 5 MB.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="agent-profile-name">Full name</Label>
          <Input id="agent-profile-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required disabled={isSaving} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-profile-phone">Contact number</Label>
          <Input id="agent-profile-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} disabled={isSaving} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-profile-email">Email ID</Label>
          <Input id="agent-profile-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} disabled={isSaving} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-profile-gender">Gender</Label>
          <Input id="agent-profile-gender" value={gender} onChange={(event) => setGender(event.target.value)} maxLength={40} disabled={isSaving} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-profile-blood-group">Blood group</Label>
          <Input id="agent-profile-blood-group" value={bloodGroup} onChange={(event) => setBloodGroup(event.target.value)} maxLength={10} placeholder="For example, O+" disabled={isSaving} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-profile-emergency">Emergency contact</Label>
          <Input id="agent-profile-emergency" type="tel" value={emergencyContact} onChange={(event) => setEmergencyContact(event.target.value)} maxLength={40} disabled={isSaving} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="agent-profile-manager">Assigned manager</Label>
          <Input id="agent-profile-manager" value={profile.manager_name ?? ""} placeholder="Not assigned" readOnly />
          <p className="text-[11px] text-slate-500">Assigned by an admin or manager.</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        {photoFile && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setPhotoFile(null);
              setPhotoPreview(profile.photo_url);
            }}
            disabled={isSaving}
          >
            <X aria-hidden="true" /> Remove selected photo
          </Button>
        )}
        <Button type="submit" className="ml-auto" disabled={isSaving || !name.trim()}>
          {isSaving ? "Saving..." : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

export function AgentSection({
  employees,
  agents,
  editableProfileId,
  openOwnProfile = false,
}: {
  employees: EmployeeDirectoryEntry[];
  agents: AgentStat[];
  editableProfileId: string | null;
  openOwnProfile?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [directory, setDirectory] = useState(employees);
  const [selected, setSelected] = useState<AgentCard | null>(() => {
    if (!openOwnProfile || !editableProfileId) return null;
    return buildAgentCards(employees, agents).find((card) => card.id === editableProfileId) ?? null;
  });

  const cards = useMemo(() => buildAgentCards(directory, agents), [directory, agents]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return cards;
    return cards.filter((card) => card.name.toLowerCase().includes(term));
  }, [cards, search]);

  // Gamification: whoever completed the most surgeries (then consultations, then
  // leads) in the selected window wears the crown. Purely derived, so it always
  // follows the dashboard filters and never needs a write.
  const topPerformer = useMemo(() => findTopPerformer(agents), [agents]);
  const crownedName = topPerformer ? topPerformer.name.trim().toLowerCase() : null;
  const isCrowned = (name: string) => crownedName !== null && name.trim().toLowerCase() === crownedName;
  const editableProfile = selected
    ? directory.find((employee) => employee.id === selected.id) ??
      employees.find((employee) => employee.id === selected.id) ??
      null
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" />
            Open an agent card to view available details. Employees can edit only their own profile.
          </p>
          {topPerformer && (
            <span className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              <Crown className="size-3.5" aria-hidden="true" />
              Star of the Month: {topPerformer.name}
            </span>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          {editableProfileId && cards.some((card) => card.id === editableProfileId) && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const ownCard = cards.find((card) => card.id === editableProfileId);
                if (ownCard) setSelected(ownCard);
              }}
            >
              <Pencil aria-hidden="true" />
              Edit my profile
            </Button>
          )}
          <div className="relative min-w-56 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search agent name"
              aria-label="Search agents by name"
              className="pl-9"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {visible.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => setSelected(card)}
            aria-label={
              card.id === editableProfileId ? "Open and edit your agent profile" : `Open secure details for ${card.name}`
            }
            className={`group flex flex-col items-center gap-3 rounded-2xl border bg-white p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
              isCrowned(card.name) ? "border-amber-200 ring-1 ring-amber-200" : "border-slate-200 hover:border-blue-200"
            }`}
          >
            <span className="relative">
              <AgentAvatar card={card} size="lg" />
              {isCrowned(card.name) && (
                <Crown
                  className="absolute -top-2 -right-2 size-6 rotate-12 fill-amber-400 text-amber-500 drop-shadow-sm"
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="text-sm font-semibold text-slate-800 group-hover:underline">{card.name}</span>
            {card.id === editableProfileId ? (
              <span className="flex items-center gap-1 text-[11px] font-medium text-blue-600">
                <Pencil className="size-3" aria-hidden="true" />
                Edit your profile
              </span>
            ) : isCrowned(card.name) ? (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                <Crown className="size-3" aria-hidden="true" />
                Star of the Month
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
                <Lock className="size-3" aria-hidden="true" />
                Details locked
              </span>
            )}
          </button>
        ))}
        {visible.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-slate-500">
            No agents on the roster yet. Add employees from Settings to see them here.
          </p>
        )}
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <AgentAvatar card={selected} size="md" />
                  <span className="flex flex-col">
                    <span className="flex flex-wrap items-center gap-2">
                      {selected.name}
                      {isCrowned(selected.name) && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          <Crown className="size-3" aria-hidden="true" />
                          Star of the Month
                        </span>
                      )}
                    </span>
                    <span className="text-xs font-normal text-slate-500 capitalize">{selected.role}</span>
                  </span>
                </DialogTitle>
                <DialogDescription className="flex items-center gap-2 text-xs">
                  <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden="true" />
                  {selected.id === editableProfileId
                    ? "Your profile and performance details are visible only while this dialog is open."
                    : "Secure panel — details are visible only while this dialog is open."}
                </DialogDescription>
              </DialogHeader>

              {selected.id === editableProfileId && editableProfile && (
                <SelfProfileEditor
                  key={selected.id}
                  profile={editableProfile}
                  onSaved={(updated) => {
                    setDirectory((current) =>
                      current.map((employee) => employee.id === updated.id ? updated : employee),
                    );
                    setSelected((current) =>
                      current?.id === updated.id
                        ? {
                            ...current,
                            name: updated.name,
                            photoUrl: updated.photo_url,
                            phone: updated.phone,
                            email: updated.email,
                            gender: updated.gender,
                            bloodGroup: updated.blood_group,
                            emergencyContact: updated.emergency_contact,
                            managerName: updated.manager_name,
                          }
                        : current,
                    );
                  }}
                />
              )}

              <div className="space-y-2">
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Performance stats</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <PerformanceChip label="DNP" value={selected.stats.cold} tone="bg-slate-100 text-slate-700" />
                  <PerformanceChip label="New Leads" value={selected.stats.newLeads} tone="bg-blue-50 text-blue-700" />
                  <PerformanceChip
                    label="Fresh Leads"
                    value={selected.stats.hot + selected.stats.warm}
                    tone="bg-amber-50 text-amber-700"
                  />
                  <PerformanceChip
                    label="OPD Booked"
                    value={selected.stats.consultations}
                    tone="bg-emerald-50 text-emerald-700"
                  />
                  <PerformanceChip label="IPD Done" value={selected.stats.surgeries} tone="bg-teal-50 text-teal-700" />
                  <PerformanceChip label="Lost Leads" value={selected.stats.lost} tone="bg-rose-50 text-rose-700" />
                </div>
                <p className="text-[11px] text-slate-400">
                  DNP = cold leads and Fresh = hot + warm, because the CRM does not capture call outcomes yet.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
                <div>
                  <p className="text-xs text-slate-500">Total leads</p>
                  <p className="text-sm font-semibold text-slate-800">{formatNumber(selected.stats.leads)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Lost/Dropped</p>
                  <p className="text-sm font-semibold text-slate-800">{formatNumber(selected.stats.lost)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Conversion</p>
                  <p className="text-sm font-semibold text-slate-800">{formatRate(selected.stats.conversion)}</p>
                </div>
              </div>

              {selected.id !== editableProfileId && <div>
                <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">HR details</p>
                <DetailRow label="Photo" value={selected.photoUrl ? "Uploaded photo" : "Emoji avatar"} />
                <DetailRow label="Full Name" value={selected.name} />
                <DetailRow label="Contact Number" value={selected.phone} />
                <DetailRow label="Email ID" value={selected.email} />
                <DetailRow label="Gender" value={selected.gender} />
                <DetailRow label="Blood Group" value={selected.bloodGroup} />
                <DetailRow label="Emergency Contact" value={selected.emergencyContact} />
                <DetailRow label="Assigned Manager" value={selected.managerName} />
              </div>}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-xs text-[11px] text-slate-400">
                  HR fields stay blank until the optional HR migration (supabase-hr-migration.sql) is applied.
                </p>
                <Link
                  href={`/dashboard?employee=${encodeURIComponent(selected.name)}`}
                  className={buttonVariants({ variant: "outline", size: "sm", className: "rounded-lg" })}
                >
                  Open this agent&apos;s leads
                </Link>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Face + name only: photo when HR provides one, otherwise an emoji/initials chip. */
function AgentAvatar({ card, size }: { card: AgentCard; size: "md" | "lg" }) {
  const dimension = size === "lg" ? "size-16 text-3xl" : "size-11 text-xl";
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-slate-100 to-white ring-1 ring-slate-200 ${dimension}`}
    >
      {card.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.photoUrl} alt="" className="size-full object-cover" />
      ) : (
        <span>{card.emoji || initials(card.name)}</span>
      )}
    </span>
  );
}
