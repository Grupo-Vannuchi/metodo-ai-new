"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, mergeAttributes, type Editor } from "@tiptap/react";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link2,
  RemoveFormatting,
  Braces,
  ImagePlus,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type EditorVariable = { token: string; label: string };

/**
 * Opt-in image support (the E-mail composer passes it; Proposals don't, so
 * their editor is unchanged). The caller owns upload and link validation.
 */
export type EditorImageSupport = {
  /** Upload a picked file; resolves to its public URL, or null (caller shows the error). */
  upload: (file: File) => Promise<string | null>;
  /** Normalize a pasted image link, or null when it's not acceptable. */
  validateSrc: (raw: string) => string | null;
  /** Normalize the optional click destination, or null when invalid. */
  validateHref: (raw: string) => string | null;
  labels: {
    button: string;
    title: string;
    upload: string;
    uploading: string;
    uploaded: string;
    orLink: string;
    linkPlaceholder: string;
    href: string;
    hrefPlaceholder: string;
    alt: string;
    altPlaceholder: string;
    insert: string;
    cancel: string;
    invalidSrc: string;
    invalidHref: string;
  };
};

/** Image node with an optional click link: renders <a href><img></a> when set. */
const LinkedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      href: {
        default: null,
        parseHTML: (element: HTMLElement) => element.closest("a")?.getAttribute("href") ?? null,
        renderHTML: () => ({}),
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const img: DOMOutputSpec = ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
    return node.attrs.href
      ? ["a", { href: node.attrs.href, target: "_blank", rel: "noopener noreferrer" }, img]
      : img;
  },
});

function ImagePanel({
  editor,
  images,
  onClose,
}: {
  editor: Editor;
  images: EditorImageSupport;
  onClose: () => void;
}) {
  const l = images.labels;
  const [uploadedSrc, setUploadedSrc] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [href, setHref] = useState("");
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    const url = await images.upload(file);
    setUploading(false);
    if (url) {
      setUploadedSrc(url);
      setLink("");
    }
  }

  function insert() {
    // An uploaded file comes from our own storage; a pasted link is validated.
    const src = uploadedSrc ?? images.validateSrc(link);
    if (!src) return setError(l.invalidSrc);
    const target = href.trim() ? images.validateHref(href) : null;
    if (href.trim() && !target) return setError(l.invalidHref);
    editor
      .chain()
      .focus()
      .insertContent({ type: "image", attrs: { src, alt: alt.trim() || null, href: target } })
      .run();
    onClose();
  }

  const fieldCls =
    "w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm focus-visible:border-brand focus-visible:outline-none";

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-muted/20 p-3 text-sm">
      <p className="font-medium">{l.title}</p>
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted">
        <ImagePlus className="size-4" />
        {uploading ? l.uploading : uploadedSrc ? l.uploaded : l.upload}
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="sr-only"
          disabled={uploading}
          onChange={(e) => {
            void onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      <span className="text-xs text-muted-foreground">{l.orLink}</span>
      <input
        aria-label={l.orLink}
        placeholder={l.linkPlaceholder}
        value={link}
        disabled={Boolean(uploadedSrc)}
        onChange={(e) => setLink(e.target.value)}
        className={fieldCls}
      />
      <input
        aria-label={l.href}
        placeholder={`${l.href} — ${l.hrefPlaceholder}`}
        value={href}
        onChange={(e) => setHref(e.target.value)}
        className={fieldCls}
      />
      <input
        aria-label={l.alt}
        placeholder={`${l.alt} — ${l.altPlaceholder}`}
        value={alt}
        onChange={(e) => setAlt(e.target.value)}
        className={fieldCls}
      />
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={insert}
          disabled={uploading || (!uploadedSrc && !link.trim())}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-60"
        >
          {l.insert}
        </button>
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">
          {l.cancel}
        </button>
      </div>
    </div>
  );
}

const SWATCHES = ["#18375d", "#0f172a", "#dc2626", "#16a34a", "#d97706", "#64748b"];

function Btn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active ? "bg-brand/10 text-brand" : "",
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px bg-border" />;

function Toolbar({
  editor,
  variables,
  image,
}: {
  editor: Editor;
  variables?: EditorVariable[];
  /** Present only when image support is on: toggles the image panel. */
  image?: { label: string; onClick: () => void };
}) {
  const [varOpen, setVarOpen] = useState(false);

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", prev ?? "https://");
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 p-1">
      <Btn title="Negrito" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="size-4" />
      </Btn>
      <Btn title="Itálico" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="size-4" />
      </Btn>
      <Btn title="Sublinhado" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className="size-4" />
      </Btn>
      <Btn title="Tachado" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="size-4" />
      </Btn>
      <Divider />
      <Btn title="Título" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="size-4" />
      </Btn>
      <Btn title="Subtítulo" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="size-4" />
      </Btn>
      <Divider />
      <Btn title="Lista" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="size-4" />
      </Btn>
      <Btn title="Lista numerada" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="size-4" />
      </Btn>
      <Divider />
      <Btn title="Alinhar à esquerda" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
        <AlignLeft className="size-4" />
      </Btn>
      <Btn title="Centralizar" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
        <AlignCenter className="size-4" />
      </Btn>
      <Btn title="Alinhar à direita" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
        <AlignRight className="size-4" />
      </Btn>
      <Divider />
      <Btn title="Link" active={editor.isActive("link")} onClick={setLink}>
        <Link2 className="size-4" />
      </Btn>
      {image ? (
        <Btn title={image.label} active={editor.isActive("image")} onClick={image.onClick}>
          <ImagePlus className="size-4" />
        </Btn>
      ) : null}
      <div className="flex items-center gap-0.5 px-1">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setColor(c).run()}
            title={`Cor ${c}`}
            aria-label={`Cor ${c}`}
            className="size-4 rounded-full border border-black/10"
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <Divider />
      <Btn title="Limpar formatação" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
        <RemoveFormatting className="size-4" />
      </Btn>

      {variables?.length ? (
        <>
          <Divider />
          <div className="relative">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setVarOpen((o) => !o)}
              title="Inserir variável"
              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Braces className="size-4" />
              Variável
            </button>
            {varOpen ? (
              <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  onClick={() => setVarOpen(false)}
                  className="fixed inset-0 z-30 cursor-default"
                />
                <div className="absolute left-0 z-40 mt-1 max-h-64 w-52 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg">
                  {variables.map((v) => (
                    <button
                      key={v.token}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        editor.chain().focus().insertContent(`{{${v.token}}}`).run();
                        setVarOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <span>{v.label}</span>
                      <code className="text-xs text-muted-foreground">{`{{${v.token}}}`}</code>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * A small WYSIWYG editor for proposal-template rich text (section bodies,
 * header/footer). Uncontrolled after mount: seeded with `value`, emits sanitized
 * HTML via `onChange` (empty string when blank). SSR-safe (immediatelyRender off).
 * Images are opt-in via `images` (read once, at mount).
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = "7rem",
  variables,
  images,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  variables?: EditorVariable[];
  images?: EditorImageSupport;
}) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const [imageOpen, setImageOpen] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      ...(images ? [LinkedImage.configure({ allowBase64: false })] : []),
    ],
    content: value || "",
    editorProps: {
      attributes: { class: "px-3 py-2 text-sm leading-relaxed focus:outline-none" },
    },
    onUpdate: ({ editor }) => onChangeRef.current(editor.isEmpty ? "" : editor.getHTML()),
  });

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card focus-within:border-brand">
      {editor ? (
        <Toolbar
          editor={editor}
          variables={variables}
          image={images ? { label: images.labels.button, onClick: () => setImageOpen((o) => !o) } : undefined}
        />
      ) : null}
      {editor && images && imageOpen ? (
        <ImagePanel editor={editor} images={images} onClose={() => setImageOpen(false)} />
      ) : null}
      <div style={{ minHeight }} className="overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
