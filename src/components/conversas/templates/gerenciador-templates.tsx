'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api, mensagemDeErro, type Loja, type Template } from '../api'
import { escolherLoja } from '../formatadores'
import { IconeSetaBaixo, IconeSetaCima } from '../icones'
import { SeletorLoja } from '../seletor-loja'
import { FormularioTemplate, type DadosFormulario } from './formulario-template'
import { moverTemplate } from './regras-template'

const BOTAO_ICONE =
  'flex h-9 w-9 items-center justify-center rounded-pilula text-texto-secundario hover:bg-superficie-bloco disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand'

/**
 * Templates de WhatsApp da loja: listar, criar, editar, excluir e ordenar.
 *
 * A ordem aqui é a ordem em que aparecem no ⚡ da conversa — os mais usados
 * no topo poupam o atendente de rolar a lista a cada resposta.
 */
export function GerenciadorTemplates({ perfilIdInicial }: { perfilIdInicial: string | null }) {
  const [lojas, setLojas] = useState<Loja[] | null>(null)
  const [perfilId, setPerfilId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [editando, setEditando] = useState<Template | 'novo' | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    api
      .listarLojas()
      .then((r) => {
        setLojas(r.lojas)
        setPerfilId(escolherLoja(r.lojas, perfilIdInicial))
      })
      .catch((e: unknown) => setErro(mensagemDeErro(e)))
  }, [perfilIdInicial])

  useEffect(() => {
    if (!perfilId) return
    let vivo = true
    setTemplates(null)
    api
      .listarTemplates(perfilId)
      .then((r) => vivo && setTemplates([...r.templates].sort((a, b) => a.ordem - b.ordem)))
      .catch((e: unknown) => vivo && setErro(mensagemDeErro(e)))
    return () => {
      vivo = false
    }
  }, [perfilId])

  function trocarLoja(id: string) {
    setPerfilId(id)
    setEditando(null)
    setErro(null)
    window.history.replaceState(null, '', `/conversas/templates?perfilId=${encodeURIComponent(id)}`)
  }

  async function salvar(dados: DadosFormulario) {
    if (!perfilId || !templates) return
    if (editando === 'novo') {
      const ordem = templates.reduce((maior, t) => Math.max(maior, t.ordem), -1) + 1
      const { template } = await api.criarTemplate(perfilId, { ...dados, ordem })
      setTemplates([...templates, template])
    } else if (editando) {
      const { template } = await api.atualizarTemplate(editando.id, { ...dados, ordem: editando.ordem })
      setTemplates(templates.map((t) => (t.id === template.id ? template : t)))
    }
    setEditando(null)
  }

  async function excluir(id: string) {
    setOcupado(true)
    setErro(null)
    try {
      await api.excluirTemplate(id)
      setTemplates((atuais) => atuais?.filter((t) => t.id !== id) ?? null)
      setConfirmando(null)
    } catch (e) {
      setErro(mensagemDeErro(e))
    } finally {
      setOcupado(false)
    }
  }

  async function mover(id: string, direcao: -1 | 1) {
    if (!templates) return
    const anterior = templates
    const nova = moverTemplate(templates, id, direcao)
    const mudaram = nova.filter((t) => anterior.find((a) => a.id === t.id)?.ordem !== t.ordem)
    setTemplates(nova)
    setOcupado(true)
    try {
      await Promise.all(
        mudaram.map((t) => api.atualizarTemplate(t.id, { titulo: t.titulo, atalho: t.atalho, texto: t.texto, ordem: t.ordem })),
      )
    } catch (e) {
      // Metade salva e metade não deixaria a ordem da tela mentindo; volta ao que estava.
      setTemplates(anterior)
      setErro(mensagemDeErro(e))
    } finally {
      setOcupado(false)
    }
  }

  const voltar = perfilId ? `/conversas?perfilId=${encodeURIComponent(perfilId)}` : '/conversas'

  return (
    <div className="flex max-w-conteudo flex-col gap-bloco">
      <div className="flex flex-col gap-2">
        <Link href={voltar} className="self-start text-dado font-medium text-brand-texto hover:underline">
          ← Voltar às conversas
        </Link>
        <h1 className="text-titulo font-bold text-texto-principal">Templates de WhatsApp</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Respostas prontas para usar nas conversas: toque no ⚡ ou digite “/atalho” no campo de mensagem. O texto entra no
          campo já com os dados do cliente, para você revisar antes de enviar.
        </p>
      </div>

      {lojas && perfilId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-cartao bg-superficie-card p-3 shadow-elevado">
          <div className="min-w-0 flex-1">
            <SeletorLoja lojas={lojas} perfilId={perfilId} aoTrocar={trocarLoja} />
          </div>
          <button
            type="button"
            onClick={() => setEditando('novo')}
            disabled={!templates || editando !== null}
            className="rounded-pilula bg-brand px-5 py-2 text-dado font-medium text-white hover:bg-brand-light disabled:opacity-60"
          >
            Novo template
          </button>
        </div>
      ) : null}

      {lojas && lojas.length === 0 ? (
        <p className="text-corpo text-texto-secundario">
          Nenhuma loja com WhatsApp. <Link href="/whatsapp" className="text-brand-texto underline">Conectar WhatsApp</Link>
        </p>
      ) : null}

      {erro ? (
        <p role="alert" className="rounded-campo bg-erro-fundo px-3 py-2 text-dado text-erro">
          {erro}
        </p>
      ) : null}

      {editando ? (
        <FormularioTemplate
          key={editando === 'novo' ? 'novo' : editando.id}
          inicial={editando === 'novo' ? null : editando}
          atalhosEmUso={(templates ?? []).filter((t) => editando === 'novo' || t.id !== editando.id).map((t) => t.atalho)}
          aoSalvar={salvar}
          aoCancelar={() => setEditando(null)}
        />
      ) : null}

      {perfilId && !templates && !erro ? <p className="text-dado text-texto-secundario">Carregando templates…</p> : null}
      {templates && templates.length === 0 && !editando ? (
        <p className="text-corpo text-texto-secundario">Nenhum template ainda. Crie o primeiro com “Novo template”.</p>
      ) : null}

      {templates && templates.length > 0 ? (
        <ol className="flex flex-col gap-2" aria-label="Templates cadastrados">
          {templates.map((t, i) => (
            <li key={t.id} className="flex flex-col gap-2 rounded-cartao bg-superficie-card p-4 shadow-elevado">
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-corpo font-bold text-texto-principal">
                    {t.titulo} {t.atalho ? <span className="text-dado font-normal text-texto-secundario">/{t.atalho}</span> : null}
                  </p>
                  <p className="line-clamp-2 whitespace-pre-wrap text-dado text-texto-secundario">{t.texto}</p>
                </div>
                <button type="button" onClick={() => void mover(t.id, -1)} disabled={ocupado || i === 0} aria-label={`Subir ${t.titulo}`} className={BOTAO_ICONE}>
                  <IconeSetaCima />
                </button>
                <button type="button" onClick={() => void mover(t.id, 1)} disabled={ocupado || i === templates.length - 1} aria-label={`Descer ${t.titulo}`} className={BOTAO_ICONE}>
                  <IconeSetaBaixo />
                </button>
              </div>

              {confirmando === t.id ? (
                <div role="alertdialog" aria-label={`Confirmar exclusão de ${t.titulo}`} className="flex flex-wrap items-center gap-2 rounded-campo bg-erro-fundo px-3 py-2">
                  <span className="flex-1 text-dado text-erro">Excluir “{t.titulo}”? Isso não pode ser desfeito.</span>
                  <button type="button" onClick={() => void excluir(t.id)} disabled={ocupado} className="rounded-pilula bg-erro px-4 py-1.5 text-dado font-medium text-white disabled:opacity-60">
                    Excluir
                  </button>
                  <button type="button" onClick={() => setConfirmando(null)} className="rounded-pilula px-4 py-1.5 text-dado font-medium text-texto-secundario">
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="flex gap-4">
                  <button type="button" onClick={() => setEditando(t)} disabled={editando !== null} className="text-dado font-medium text-brand-texto hover:underline disabled:opacity-60">
                    Editar
                  </button>
                  <button type="button" onClick={() => setConfirmando(t.id)} className="text-dado font-medium text-erro hover:underline">
                    Excluir
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
