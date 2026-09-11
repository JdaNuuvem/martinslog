'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Conexao = {
  instancia: string
  numero: string | null
  conectadoEm: string | null
  ultimoErro: string | null
  estado: string | null
  qrcode: string | null
}

/** Enquanto o QR não é lido, a Evolution troca o código a cada ~40s. */
const INTERVALO_QR_MS = 20_000

function telefoneLegivel(digitos: string): string {
  const semPais = digitos.startsWith('55') ? digitos.slice(2) : digitos
  if (semPais.length < 10) return digitos
  const ddd = semPais.slice(0, 2)
  const resto = semPais.slice(2)
  const meio = resto.length > 8 ? resto.slice(0, 5) : resto.slice(0, 4)
  return `(${ddd}) ${meio}-${resto.slice(meio.length)}`
}

/**
 * WhatsApp pela Evolution: parear o celular e escolher por onde a loja fala.
 *
 * As conversas moram em tela própria (`/whatsapp/conversas`) — aqui é só a
 * conexão. Misturar as duas faria a tela de configuração crescer sem parar,
 * e conversa é coisa que se abre o dia inteiro, não uma vez por mês.
 */
export function ConexaoEvolution() {
  const [disponivel, setDisponivel] = useState<boolean | null>(null)
  const [provedor, setProvedor] = useState<'META' | 'EVOLUTION'>('META')
  const [conexao, setConexao] = useState<Conexao | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch('/api/evolution')
      const corpo = (await resposta.json().catch(() => ({}))) as {
        disponivel?: boolean
        provedor?: 'META' | 'EVOLUTION'
        conexao?: Conexao | null
        mensagem?: string
      }

      if (!resposta.ok) {
        setErro(corpo.mensagem ?? 'Não foi possível carregar a conexão.')
        return
      }

      setDisponivel(corpo.disponivel ?? false)
      setProvedor(corpo.provedor ?? 'META')
      setConexao(corpo.conexao ?? null)
      setErro(null)
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  /*
    Reconsulta enquanto o QR está na tela.

    O código expira sozinho na Evolution; sem isto o lojista miraria a câmera
    num QR morto e concluiria que o sistema não funciona. Para quando conecta,
    para não ficar batendo na Evolution à toa.
  */
  const aguardandoPareamento = disponivel === true && conexao?.estado !== 'open'
  useEffect(() => {
    if (!aguardandoPareamento) return
    const timer = setInterval(() => void carregar(), INTERVALO_QR_MS)
    return () => clearInterval(timer)
  }, [aguardandoPareamento, carregar])

  async function trocarProvedor(novo: 'META' | 'EVOLUTION') {
    setErro(null)
    setAviso(null)
    const resposta = await fetch('/api/evolution', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provedor: novo }),
    })
    if (!resposta.ok) {
      const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string }
      setErro(corpo.mensagem ?? 'Não foi possível trocar o provedor.')
      return
    }
    setProvedor(novo)
    setAviso(
      novo === 'EVOLUTION'
        ? 'As mensagens passam a sair pelo celular pareado aqui.'
        : 'As mensagens voltam a sair pela API oficial da Meta.',
    )
    await carregar()
  }

  async function desconectar() {
    setErro(null)
    setAviso(null)
    const resposta = await fetch('/api/evolution', { method: 'DELETE' })
    if (!resposta.ok) {
      setErro('Não foi possível desconectar.')
      return
    }
    setAviso('Celular desconectado e instância apagada.')
    await carregar()
  }

  if (carregando) {
    return (
      <section className="rounded-xl bg-superficie-card p-6">
        <p className="text-sm text-texto-secundario">Carregando…</p>
      </section>
    )
  }

  if (disponivel === false) {
    return (
      <section className="flex flex-col gap-3 rounded-xl bg-superficie-card p-6">
        <h2 className="text-lg font-bold text-texto-principal">WhatsApp sem verificação</h2>
        <p className="text-sm text-texto-secundario">
          Este servidor não tem a Evolution instalada, então só a API oficial da Meta está
          disponível. Quem cuida da instalação precisa configurar{' '}
          <span className="font-mono">EVOLUTION_API_URL</span> e{' '}
          <span className="font-mono">EVOLUTION_API_KEY</span>.
        </p>
      </section>
    )
  }

  const conectado = conexao?.estado === 'open'

  return (
    <section className="flex flex-col gap-5 rounded-xl bg-superficie-card p-6">
      <div>
        <h2 className="text-lg font-bold text-texto-principal">WhatsApp sem verificação</h2>
        <p className="text-sm text-texto-secundario">
          Pareia um celular por QR, como no WhatsApp Web. Não exige CNPJ, verificação na Meta nem
          template aprovado — e permite conversar com o comprador.
        </p>
      </div>

      {/*
        Os dois avisos ficam antes do QR de propósito: são o que não se
        descobre testando, e o que custa caro quando se descobre depois.

        O segundo nasceu de um caso real — alguém pareou o celular pessoal
        para ver a tela funcionar, e ao parear o WhatsApp sincronizou a agenda
        inteira para o servidor. Ninguém pediu isso, e não havia como saber
        antes de acontecer.
      */}
      <div className="flex flex-col gap-2">
        <p className="rounded-lg border border-borda-campo bg-superficie-bloco p-3 text-sm text-texto-secundario">
          <span className="font-medium text-texto-principal">Risco do número:</span> este caminho não
          é oficial. A Meta pode bloquear o número se o volume ou o conteúdo parecer disparo em
          massa, e um número bloqueado não volta.
        </p>
        <p className="rounded-lg border border-borda-campo bg-superficie-bloco p-3 text-sm text-texto-secundario">
          <span className="font-medium text-texto-principal">Use um chip só da loja:</span> ao
          parear, o WhatsApp copia para este servidor a lista de contatos do aparelho — é como o
          protocolo funciona, não é opção que dê para desligar. Com um celular pessoal, a agenda
          pessoal vem junto. Desconectar apaga as conversas copiadas; a lista de números fica em
          cache no servidor até alguém limpá-la.
        </p>
      </div>

      {erro ? (
        <p role="alert" className="rounded-lg bg-superficie-bloco p-3 text-sm text-erro">
          {erro}
        </p>
      ) : null}
      {aviso ? (
        <p role="status" className="rounded-lg bg-brand-bg p-3 text-sm text-brand-texto">
          {aviso}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 rounded-lg border border-borda-campo bg-superficie-bloco p-4">
        <p className="text-sm font-medium text-texto-principal">Por onde as mensagens saem hoje</p>
        <div className="flex flex-wrap gap-2">
          {(['META', 'EVOLUTION'] as const).map((opcao) => (
            <button
              key={opcao}
              type="button"
              onClick={() => void trocarProvedor(opcao)}
              aria-pressed={provedor === opcao}
              className={`rounded-pilula px-4 py-2 text-sm font-medium ${
                provedor === opcao
                  ? 'bg-brand text-white'
                  : 'border border-borda-campo text-texto-secundario'
              }`}
            >
              {opcao === 'META' ? 'API oficial (Meta)' : 'Celular pareado (aqui)'}
            </button>
          ))}
        </div>
        {provedor === 'EVOLUTION' && !conectado ? (
          <p className="text-xs text-erro">
            Escolhido, mas sem celular pareado: as mensagens não vão sair até você ler o QR abaixo.
          </p>
        ) : null}
      </div>

      {conectado ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-borda-campo bg-superficie-bloco p-4">
            <div>
              <p className="text-sm font-medium text-texto-principal">
                Celular conectado
                {conexao?.numero ? ` · ${telefoneLegivel(conexao.numero)}` : ''}
              </p>
              <p className="text-sm text-texto-secundario">Instância {conexao?.instancia}</p>
            </div>
            <button
              type="button"
              onClick={() => void desconectar()}
              className="text-sm font-medium text-erro hover:underline"
            >
              Desconectar
            </button>
          </div>
          <Link
            href="/whatsapp/conversas"
            className="self-start rounded-pilula bg-brand px-6 py-2 text-sm font-medium text-white"
          >
            Abrir conversas
          </Link>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-borda-campo bg-superficie-bloco p-6">
          <p className="text-sm text-texto-secundario">
            No celular: WhatsApp → Aparelhos conectados → Conectar aparelho.
          </p>
          {conexao?.qrcode ? (
            <Image
              src={conexao.qrcode}
              alt="QR code para conectar o WhatsApp"
              width={240}
              height={240}
              unoptimized
              className="rounded-lg bg-white p-2"
            />
          ) : (
            <p className="text-sm text-texto-secundario">Gerando o QR code…</p>
          )}
          <p className="text-xs text-texto-secundario">
            O código muda sozinho a cada poucos segundos. Esta tela acompanha.
          </p>
        </div>
      )}
    </section>
  )
}
