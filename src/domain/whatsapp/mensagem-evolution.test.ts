import { describe, expect, it } from 'vitest'
import {
  jidDeConversa,
  lerMensagem,
  previaDe,
  statusAnterioresA,
  statusDaEvolution,
  telefoneDoJid,
} from './mensagem-evolution'

/**
 * A leitura do registro cru da Evolution.
 *
 * Os registros abaixo copiam o formato medido em produção na v2.3.7. Se a
 * Evolution mudar o formato, é aqui que o vermelho aparece — e não na tela,
 * como uma conversa cheia de balões vazios.
 */

const base = {
  pushName: 'Maria',
  messageType: 'conversation',
  messageTimestamp: 1_757_700_000,
  instanceId: 'x',
  source: 'android',
  MessageUpdate: [],
}

describe('lerMensagem', () => {
  it.each([
    [{ buttonsMessage: { contentText: 'Quer a segunda via?', buttons: [] } }, 'Quer a segunda via?'],
    [{ buttonsResponseMessage: { selectedButtonId: 'nao', selectedDisplayText: 'Não salvar' } }, 'Não salvar'],
    [{ interactiveMessage: { body: { text: 'Como avalia o atendimento?' } } }, 'Como avalia o atendimento?'],
    [{ listResponseMessage: { title: '2ª Via' } }, '2ª Via'],
    [{ listMessage: { description: 'Escolha uma opção', sections: [] } }, 'Escolha uma opção'],
    [{ templateMessage: { hydratedTemplate: { hydratedContentText: 'Olá, Aldezir.' } } }, 'Olá, Aldezir.'],
  ])('lê o texto de mensagem com botão, lista ou template (%#)', (message, esperado) => {
    const lida = lerMensagem({ ...base, key: { id: 'B1', fromMe: false, remoteJid: '5511999990000@s.whatsapp.net' }, message })
    expect(lida?.tipo).toBe('TEXTO')
    expect(lida?.texto).toBe(esperado)
  })

  it('preserva o @lid como jid e não inventa telefone a partir dele', () => {
    const lida = lerMensagem({
      ...base,
      key: { id: 'A1', fromMe: false, remoteJid: '123456789012345@lid' },
      message: { conversation: 'oi', messageContextInfo: {} },
    })

    expect(lida?.jid).toBe('123456789012345@lid')
    expect(lida?.telefone).toBeNull()
    expect(lida?.tipo).toBe('TEXTO')
    expect(lida?.texto).toBe('oi')
    expect(lida?.ocorridoEm.toISOString()).toBe(new Date(1_757_700_000_000).toISOString())
  })

  it('usa o número alternativo quando a Evolution conta quem está por trás do @lid', () => {
    const lida = lerMensagem({
      ...base,
      key: {
        id: 'A2',
        fromMe: false,
        remoteJid: '999@lid',
        remoteJidAlt: '5511988887777@s.whatsapp.net',
      },
      message: { conversation: 'oi' },
    })
    expect(lida?.jid).toBe('999@lid')
    expect(lida?.telefone).toBe('5511988887777')
  })

  it('marca fromMe', () => {
    const lida = lerMensagem({
      ...base,
      key: { id: 'A3', fromMe: true, remoteJid: '5511911112222@s.whatsapp.net' },
      message: { conversation: 'mandei do celular' },
    })
    expect(lida?.fromMe).toBe(true)
    expect(lida?.telefone).toBe('5511911112222')
  })

  it('lê áudio com mimetype, tamanho em Long e duração', () => {
    const lida = lerMensagem({
      ...base,
      messageType: 'audioMessage',
      key: { id: 'A4', fromMe: false, remoteJid: '1@lid' },
      message: {
        audioMessage: {
          mimetype: 'audio/ogg; codecs=opus',
          fileLength: { low: 12345, high: 0, unsigned: true },
          seconds: 7,
          ptt: true,
        },
      },
    })
    expect(lida).toMatchObject({
      tipo: 'AUDIO',
      texto: null,
      midiaMimetype: 'audio/ogg; codecs=opus',
      midiaTamanho: 12345,
      midiaDuracao: 7,
    })
  })

  it('documento com legenda embrulhado em documentWithCaptionMessage', () => {
    const lida = lerMensagem({
      ...base,
      key: { id: 'A5', fromMe: false, remoteJid: '1@lid' },
      message: {
        documentWithCaptionMessage: {
          message: {
            documentMessage: {
              mimetype: 'application/pdf',
              fileName: 'nota.pdf',
              fileLength: '2048',
              caption: 'segue a nota',
            },
          },
        },
      },
    })
    expect(lida).toMatchObject({
      tipo: 'DOCUMENTO',
      texto: 'segue a nota',
      midiaNome: 'nota.pdf',
      midiaTamanho: 2048,
    })
  })

  it('imagem, vídeo e figurinha', () => {
    const tipo = (message: Record<string, unknown>) =>
      lerMensagem({ ...base, key: { id: 'x', remoteJid: '1@lid' }, message })?.tipo
    expect(tipo({ imageMessage: { mimetype: 'image/jpeg', caption: 'foto' } })).toBe('IMAGEM')
    expect(tipo({ videoMessage: { mimetype: 'video/mp4' } })).toBe('VIDEO')
    expect(tipo({ stickerMessage: { mimetype: 'image/webp' } })).toBe('FIGURINHA')
    expect(tipo({ locationMessage: { degreesLatitude: 1 } })).toBe('OUTRO')
  })

  it('ignora grupo, status, reação e mensagem só com messageContextInfo', () => {
    expect(
      lerMensagem({ ...base, key: { id: 'g', remoteJid: '1203@g.us' }, message: { conversation: 'oi' } }),
    ).toBeNull()
    expect(
      lerMensagem({
        ...base,
        key: { id: 's', remoteJid: 'status@broadcast' },
        message: { conversation: 'oi' },
      }),
    ).toBeNull()
    expect(
      lerMensagem({ ...base, key: { id: 'r', remoteJid: '1@lid' }, message: { reactionMessage: {} } }),
    ).toBeNull()
    expect(
      lerMensagem({ ...base, key: { id: 'c', remoteJid: '1@lid' }, message: { messageContextInfo: {} } }),
    ).toBeNull()
  })
})

describe('jid e telefone', () => {
  it('só conversa individual conta', () => {
    expect(jidDeConversa('1@lid')).toBe(true)
    expect(jidDeConversa('5511@s.whatsapp.net')).toBe(true)
    expect(jidDeConversa('1@g.us')).toBe(false)
    expect(jidDeConversa('status@broadcast')).toBe(false)
  })

  it('telefone só de jid de telefone, sem o sufixo de dispositivo', () => {
    expect(telefoneDoJid('5511911112222:12@s.whatsapp.net')).toBe('5511911112222')
    expect(telefoneDoJid('123@lid')).toBeNull()
  })
})

describe('status', () => {
  it('traduz os valores da Evolution', () => {
    expect(statusDaEvolution('DELIVERY_ACK')).toBe('ENTREGUE')
    expect(statusDaEvolution('PLAYED')).toBe('LIDA')
    expect(statusDaEvolution('PENDING')).toBeNull()
  })

  it('não anda para trás', () => {
    expect(statusAnterioresA('ENTREGUE')).toEqual(['ENVIANDO', 'ENVIADA'])
    expect(statusAnterioresA('LIDA')).not.toContain('LIDA')
    expect(statusAnterioresA('ERRO')).toEqual(['ENVIANDO'])
  })

  it('prévia de mídia sem legenda', () => {
    expect(previaDe('AUDIO', null)).toBe('Áudio')
    expect(previaDe('IMAGEM', 'legenda')).toBe('legenda')
  })
})
