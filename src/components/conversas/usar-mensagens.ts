'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ErroApi, mensagemDeErro, type Mensagem } from './api'
import {
  PREFIXO_ID_LOCAL,
  marcoDaConsulta,
  mesclarMensagens,
  substituirMensagem,
  tipoDoArquivo,
} from './formatadores'

/**
 * De quanto em quanto a conversa aberta busca novidade.
 *
 * Consulta periódica, como na tela anterior, mas incremental: pede só a ponta
 * final (`depoisDe`) e mescla por id. Cinco segundos é o intervalo em que o
 * atendente ainda sente a conversa "ao vivo" sem recarregar cinquenta
 * mensagens a cada volta.
 */
const INTERVALO_MS = 5_000

export type Envio =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'arquivo'; arquivo: File; legenda: string }
  | { tipo: 'audio'; audio: Blob; nomeArquivo: string; duracao: number }

/** O que mudou por último — a área de mensagens decide a rolagem por isto. */
export type Mudanca = 'inicial' | 'antigas' | 'novas' | 'envio'

type Estado = { lista: Mensagem[]; mudanca: Mudanca; versao: number }

export function useMensagens(conversaId: string, aoChegarDoCliente: () => void) {
  const [estado, setEstado] = useState<Estado>({ lista: [], mudanca: 'inicial', versao: 0 })
  const [temMais, setTemMais] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [carregandoAntigas, setCarregandoAntigas] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const listaRef = useRef<Mensagem[]>([])
  const reenvios = useRef(new Map<string, Envio>())
  const urlsLocais = useRef<string[]>([])
  const aoChegarRef = useRef(aoChegarDoCliente)

  useEffect(() => {
    listaRef.current = estado.lista
  }, [estado.lista])

  useEffect(() => {
    aoChegarRef.current = aoChegarDoCliente
  }, [aoChegarDoCliente])

  const aplicar = useCallback((transformar: (lista: Mensagem[]) => Mensagem[], mudanca: Mudanca) => {
    setEstado((atual) => ({ lista: transformar(atual.lista), mudanca, versao: atual.versao + 1 }))
  }, [])

  useEffect(() => {
    let vivo = true
    api
      .listarMensagens(conversaId)
      .then((r) => {
        if (!vivo) return
        aplicar(() => r.mensagens, 'inicial')
        setTemMais(r.temMais)
      })
      .catch((e: unknown) => vivo && setErro(mensagemDeErro(e)))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [conversaId, aplicar])

  // Pré-visualizações locais (foto, áudio gravado) só vivem enquanto a conversa está aberta.
  useEffect(() => {
    const urls = urlsLocais.current
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  useEffect(() => {
    let emVoo = false
    const timer = setInterval(async () => {
      // Aba escondida não precisa de novidade; quando voltar, a próxima volta traz tudo.
      if (emVoo || document.hidden) return
      emVoo = true
      try {
        const atual = listaRef.current
        const r = await api.listarMensagens(conversaId, { depoisDe: marcoDaConsulta(atual) })
        const porId = new Map(atual.map((m) => [m.id, m]))
        const mudou = r.mensagens.filter((m) => {
          const antes = porId.get(m.id)
          return !antes || antes.status !== m.status || antes.erro !== m.erro || antes.texto !== m.texto
        })
        if (mudou.length === 0) return
        aplicar((lista) => mesclarMensagens(lista, mudou), 'novas')
        if (mudou.some((m) => m.autor === 'CLIENTE' && !porId.has(m.id))) aoChegarRef.current()
      } catch {
        // Falha de uma volta não merece alarde: a próxima tenta de novo.
      } finally {
        emVoo = false
      }
    }, INTERVALO_MS)
    return () => clearInterval(timer)
  }, [conversaId, aplicar])

  const carregarAntigas = useCallback(async () => {
    const primeira = listaRef.current.find((m) => !m.id.startsWith(PREFIXO_ID_LOCAL))
    if (!temMais || carregandoAntigas || !primeira) return
    setCarregandoAntigas(true)
    try {
      const r = await api.listarMensagens(conversaId, { antesDe: primeira.ocorridoEm })
      aplicar((lista) => mesclarMensagens(lista, r.mensagens), 'antigas')
      setTemMais(r.temMais)
    } catch (e) {
      setErro(mensagemDeErro(e))
    } finally {
      setCarregandoAntigas(false)
    }
  }, [conversaId, temMais, carregandoAntigas, aplicar])

  const enviar = useCallback(
    async (envio: Envio) => {
      const idLocal = `${PREFIXO_ID_LOCAL}${Date.now()}-${Math.random().toString(36).slice(2)}`
      const otimista = mensagemOtimista(idLocal, envio)
      if (otimista.midia) urlsLocais.current.push(otimista.midia.url)
      reenvios.current.set(idLocal, envio)
      aplicar((lista) => [...lista, otimista], 'envio')

      try {
        const { mensagem } =
          envio.tipo === 'texto'
            ? await api.enviarTexto(conversaId, envio.texto)
            : envio.tipo === 'arquivo'
              ? await api.enviarArquivo(conversaId, envio.arquivo, envio.legenda)
              : await api.enviarAudio(conversaId, envio.audio, envio.nomeArquivo, envio.duracao)
        reenvios.current.delete(idLocal)
        // O servidor pode gravar a tentativa já com ERRO (WhatsApp recusou):
        // o reenvio continua possível a partir do balão dele.
        if (mensagem.status === 'ERRO') reenvios.current.set(mensagem.id, envio)
        aplicar((lista) => substituirMensagem(lista, idLocal, mensagem), 'envio')
      } catch (e) {
        if (e instanceof ErroApi && e.registro) {
          // O servidor gravou a tentativa: o balão passa a ser o dele, e não
          // um segundo balão que a consulta periódica traria depois.
          const registro = e.registro
          reenvios.current.delete(idLocal)
          reenvios.current.set(registro.id, envio)
          aplicar((lista) => substituirMensagem(lista, idLocal, registro), 'envio')
          return
        }
        const texto = mensagemDeErro(e)
        aplicar(
          (lista) => lista.map((m) => (m.id === idLocal ? { ...m, status: 'ERRO', erro: texto } : m)),
          'envio',
        )
      }
    },
    [conversaId, aplicar],
  )

  const tentarDeNovo = useCallback(
    (id: string) => {
      const envio = reenvios.current.get(id)
      if (!envio) return
      reenvios.current.delete(id)
      aplicar((lista) => lista.filter((m) => m.id !== id), 'envio')
      void enviar(envio)
    },
    [aplicar, enviar],
  )

  const podeTentarDeNovo = useCallback((id: string) => reenvios.current.has(id), [])

  return {
    mensagens: estado.lista,
    mudanca: estado.mudanca,
    versao: estado.versao,
    temMais,
    carregando,
    carregandoAntigas,
    erro,
    limparErro: () => setErro(null),
    carregarAntigas,
    enviar,
    tentarDeNovo,
    podeTentarDeNovo,
  }
}

function mensagemOtimista(id: string, envio: Envio): Mensagem {
  const base = { id, autor: 'ATENDENTE' as const, status: 'ENVIANDO' as const, erro: null, ocorridoEm: new Date().toISOString() }
  if (envio.tipo === 'texto') return { ...base, tipo: 'TEXTO', texto: envio.texto, midia: null }
  if (envio.tipo === 'arquivo') {
    return {
      ...base,
      tipo: tipoDoArquivo(envio.arquivo.type),
      texto: envio.legenda.trim() || null,
      midia: {
        url: URL.createObjectURL(envio.arquivo),
        mimetype: envio.arquivo.type,
        nome: envio.arquivo.name,
        tamanho: envio.arquivo.size,
        duracao: null,
      },
    }
  }
  return {
    ...base,
    tipo: 'AUDIO',
    texto: null,
    midia: {
      url: URL.createObjectURL(envio.audio),
      mimetype: envio.audio.type,
      nome: envio.nomeArquivo,
      tamanho: envio.audio.size,
      duracao: envio.duracao,
    },
  }
}
