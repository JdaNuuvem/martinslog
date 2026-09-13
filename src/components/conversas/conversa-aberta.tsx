'use client'

import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { IconeFechar } from '@/components/layout/icones'
import { api, mensagemDeErro, type ResumoConversa } from './api'
import { AreaMensagens } from './area-mensagens'
import { BuscaNaConversa } from './busca-na-conversa'
import { CabecalhoConversa } from './cabecalho-conversa'
import { Compositor } from './compositor'
import { mensagensComTermo, nomeDoContato } from './formatadores'
import { useMensagens } from './usar-mensagens'
import { VisualizadorImagem } from './visualizador-imagem'

type ConversaAbertaProps = {
  conversa: ResumoConversa
  perfilId: string
  aoVoltar: () => void
  aoAtualizarResumo: (id: string, mudanca: Partial<ResumoConversa>) => void
}

/**
 * A conversa aberta: cabeçalho, mensagens e campo de envio.
 *
 * É montada com `key` pelo id da conversa, então trocar de conversa zera todo
 * o estado daqui — mensagens, busca, anexo em prévia. Um anexo escolhido para
 * a Maria não pode continuar na tela quando o atendente abre o João.
 */
export function ConversaAberta({ conversa, perfilId, aoVoltar, aoAtualizarResumo }: ConversaAbertaProps) {
  const [roboPausado, setRoboPausado] = useState(conversa.roboPausado)
  const [alternandoRobo, setAlternandoRobo] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [imagem, setImagem] = useState<{ url: string; legenda: string | null } | null>(null)
  const [buscaAberta, setBuscaAberta] = useState(false)
  const [termo, setTermo] = useState('')
  const [posicao, setPosicao] = useState(0)
  const [arrastando, setArrastando] = useState(false)
  const [anexoSolto, setAnexoSolto] = useState<File | null>(null)

  const marcarLida = useCallback(() => {
    // Falhar em marcar como lida não impede ninguém de atender; não vale um aviso.
    api.marcarLida(conversa.id).catch(() => undefined)
    aoAtualizarResumo(conversa.id, { naoLidas: 0 })
  }, [conversa.id, aoAtualizarResumo])

  const m = useMensagens(conversa.id, marcarLida)

  useEffect(() => {
    marcarLida()
  }, [marcarLida])

  const achados = useMemo(() => (buscaAberta ? mensagensComTermo(m.mensagens, termo) : []), [buscaAberta, m.mensagens, termo])
  // Posição 0 é a ocorrência mais recente — a última da lista cronológica.
  const idFoco = achados[achados.length - 1 - Math.min(posicao, achados.length - 1)] ?? null

  const abrirImagem = useCallback((url: string, legenda: string | null) => setImagem({ url, legenda }), [])
  const receberAnexo = useCallback(() => setAnexoSolto(null), [])

  async function alternarRobo() {
    setAlternandoRobo(true)
    try {
      const r = await api.alternarRobo(conversa.id, roboPausado ? 'devolver-ao-robo' : 'assumir')
      const pausado = Boolean(r.roboPausadoAte && new Date(r.roboPausadoAte).getTime() > Date.now())
      setRoboPausado(pausado)
      aoAtualizarResumo(conversa.id, { roboPausado: pausado })
    } catch (e) {
      setAviso(mensagemDeErro(e))
    } finally {
      setAlternandoRobo(false)
    }
  }

  const temArquivo = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  const erroVisivel = aviso ?? m.erro

  return (
    <section
      aria-label={`Conversa com ${nomeDoContato(conversa)}`}
      className="relative flex h-full min-h-0 flex-col"
      onDragEnter={(e) => {
        if (!temArquivo(e)) return
        e.preventDefault()
        setArrastando(true)
      }}
      onDragOver={(e) => {
        if (temArquivo(e)) e.preventDefault()
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(false)
      }}
      onDrop={(e) => {
        if (!temArquivo(e)) return
        e.preventDefault()
        setArrastando(false)
        const arquivo = e.dataTransfer.files[0]
        if (arquivo) setAnexoSolto(arquivo)
      }}
    >
      <CabecalhoConversa
        conversa={conversa}
        roboPausado={roboPausado}
        alternandoRobo={alternandoRobo}
        buscaAberta={buscaAberta}
        aoVoltar={aoVoltar}
        aoAlternarBusca={() => {
          setBuscaAberta((aberta) => !aberta)
          setTermo('')
          setPosicao(0)
        }}
        aoAlternarRobo={() => void alternarRobo()}
      />

      {buscaAberta ? (
        <BuscaNaConversa
          termo={termo}
          total={achados.length}
          posicao={Math.min(posicao, Math.max(0, achados.length - 1))}
          temMais={m.temMais}
          carregandoAntigas={m.carregandoAntigas}
          aoMudarTermo={(t) => {
            setTermo(t)
            setPosicao(0)
          }}
          aoMudarPosicao={setPosicao}
          aoCarregarAntigas={() => void m.carregarAntigas()}
          aoFechar={() => {
            setBuscaAberta(false)
            setTermo('')
          }}
        />
      ) : null}

      {erroVisivel ? (
        <div role="alert" className="flex items-center gap-2 bg-erro-fundo px-4 py-2 text-dado text-erro">
          <span className="flex-1">{erroVisivel}</span>
          <button
            type="button"
            onClick={() => {
              setAviso(null)
              m.limparErro()
            }}
            aria-label="Fechar aviso"
            className="rounded-pilula p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <IconeFechar width={16} height={16} />
          </button>
        </div>
      ) : null}

      <AreaMensagens
        mensagens={m.mensagens}
        mudanca={m.mudanca}
        versao={m.versao}
        temMais={m.temMais}
        carregando={m.carregando}
        carregandoAntigas={m.carregandoAntigas}
        termo={buscaAberta ? termo : ''}
        idFoco={idFoco}
        podeTentarDeNovo={m.podeTentarDeNovo}
        aoTentarDeNovo={m.tentarDeNovo}
        aoCarregarAntigas={() => void m.carregarAntigas()}
        aoAbrirImagem={abrirImagem}
      />

      <Compositor
        conversaId={conversa.id}
        perfilId={perfilId}
        aoEnviar={(envio) => void m.enviar(envio)}
        anexoRecebido={anexoSolto}
        aoReceberAnexo={receberAnexo}
      />

      {arrastando ? (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-painel border-2 border-dashed border-brand bg-brand-bg/90">
          <p className="text-subtitulo font-bold text-brand-texto">Solte o arquivo para enviar</p>
        </div>
      ) : null}

      <VisualizadorImagem url={imagem?.url ?? null} legenda={imagem?.legenda ?? null} aoFechar={() => setImagem(null)} />
    </section>
  )
}
