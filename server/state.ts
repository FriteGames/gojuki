import * as _ from 'lodash'
import {
    PlayerInput,
    World,
    getDefaultPlayer,
    stepPlayer,
    stepWorld,
    powerups,
    getDefaultGame,
} from './game'
const maxPartySize = 3
let serverTick = 0

/* Messages & message creators */
export type JOIN_PARTY_MESSAGE = {
    type: 'JOIN_PARTY'
    playerName: string
    peerId: string
    partyId?: string
    test?: boolean
}
export type PLAYER_INPUTS = { type: 'CLIENT_INPUTS'; input: PlayerInput }
export type PLAYER_UPGRADE_MESSAGE = {
    type: 'PLAYER_UPGRADES'
    powerup: Powerup
    delta: 1 | -1
}
export type SERVER_TICK_MESSAGE = {
    type: 'SERVER_TICK'
    party: null | PartyState
    serverTick: number
    clientTick: number
    delay: number
}

export type START_GAME_MESSAGE = {
    type: 'START_GAME'
    partyId: string
}

export type CLIENT_TICK_MESSAGE = {
    type: 'CLIENT_TICK'
    inputs: Array<[number, PlayerInput]>
    serverTick: number
    clientTick: number
}

export type Message =
    | JOIN_PARTY_MESSAGE
    | PLAYER_INPUTS
    | SERVER_TICK_MESSAGE
    | PLAYER_UPGRADE_MESSAGE
    | CLIENT_TICK_MESSAGE
    | START_GAME_MESSAGE

type Powerup = 'Sticky Goo' | 'Speed' | 'Food Carry Limit'
export function selectUpgrade(powerup: Powerup, delta: 1 | -1): PLAYER_UPGRADE_MESSAGE {
    return {
        type: 'PLAYER_UPGRADES',
        powerup,
        delta,
    }
}

export function joinParty(
    peerId: string,
    partyId: string,
    playerName: string,
    test?: boolean,
): JOIN_PARTY_MESSAGE {
    const partyMsg: JOIN_PARTY_MESSAGE = {
        type: 'JOIN_PARTY',
        playerName,
        peerId,
    }
    if (test) {
        partyMsg.test = test
    }
    if (partyId) {
        partyMsg.partyId = partyId
    }

    return partyMsg
}

export function startGame(partyId: string): START_GAME_MESSAGE {
    return { type: 'START_GAME', partyId }
}

/* State Types*/
export type stateT = {
    parties: { [id: string]: PartyState }
    clientTicks: {
        [id: string]: { clientTick: number; ackedServerTick: number; capturedAt: number }
    }
}

export type PartyStatus = 'NOT_STARTED' | 'LOBBY' | 'PLAYING' | 'FINISHED' | 'UPGRADES' | 'TEST'
export type PartyState = {
    players: Array<Player>
    status: PartyStatus
    serverTick: number
    game: World | undefined
    partyId: string
}

export type Player = {
    playerName: string
    peerId: string
}

/* State Handlers */

let state: stateT = {
    parties: {},
    clientTicks: {},
}

let partyIndex: any = {}
let nextParty = 1
export function initTicks(peerId: string) {
    state.clientTicks[peerId] = {
        ackedServerTick: -1,
        clientTick: -1,
        capturedAt: -1,
    }
}

export function handleMessage(message: Message, peerId: string) {
    if (message.type === 'JOIN_PARTY') {
        return handleJoinParty(message, peerId)
    } else if (message.type === 'PLAYER_UPGRADES') {
        return handlePlayerUpgrades(message, peerId)
    } else if (message.type === 'CLIENT_TICK') {
        return handleClientTick(message, peerId)
    } else if (message.type === 'START_GAME') {
        return handleStartGame(message)
    }
}

function handleJoinParty(
    message: JOIN_PARTY_MESSAGE,
    peerId: string,
): { partyId: string } | { err: string } {
    let { partyId, test, playerName } = message
    // If not specifying a partyId, check to see if should rejoin an in-progress game.
    if (!partyId) {
        const rejoiningParty = Object.values(state.parties).find(
            party =>
                party.players?.some(player => player.peerId === peerId) &&
                party.status !== 'FINISHED',
        )

        if (rejoiningParty) {
            partyIndex[peerId] = rejoiningParty.partyId
            return { partyId: rejoiningParty.partyId }
        }
    }

    if (state.parties[partyId] && state.parties[partyId].players.length === 4) {
        return { err: 'Sorry, this party is full' }
    }

    if (!partyId) {
        partyId = Object.keys(state.parties).find(partyId => {
            const party = state.parties[partyId]
            return party.status === 'LOBBY' && party.players.length < maxPartySize
        })
    }
    if (!partyId) {
        partyId = String(nextParty++)
    }
    let party = state.parties[partyId]

    if (!party) {
        party = state.parties[partyId] = {
            status: 'LOBBY',
            players: [],
            serverTick,
            game: undefined,
            partyId,
        }
    }

    party.players.push({ peerId, playerName })
    party.serverTick = serverTick
    partyIndex[peerId] = partyId

    if (test) {
        handleStartGame(startGame(partyId))
        state.parties[partyId].status = 'TEST'
    }

    return { partyId }
}

export function handleStartGame(message: START_GAME_MESSAGE) {
    const party = state.parties[message.partyId]
    if (party.players.length > 4) {
        console.error(`Should never be more than 4 player, but there were: ${party.players.length}`)
        return
    }
    if (party.status !== 'LOBBY') {
        console.error(
            `Can only start a game that has not already been started. PartyId: ${message.partyId}`,
        )
        return
    }

    party.status = 'PLAYING'
    party.game = getDefaultGame(party.players)

    // HACK TO START AT UPGRADES
    const upgradesHack = false
    if (upgradesHack) {
        party.status = 'UPGRADES'
        party.game.players[party.players[0].peerId].food = 18
    }
}

function handleClientTick(message: CLIENT_TICK_MESSAGE, peerId: string) {
    if (message.clientTick <= state.clientTicks[peerId].clientTick) {
        // console.log(
        //     `dupe or outdated message because of outdated clientTick: ${message.clientTick}`,
        // )
    }

    if (!getPartyId(peerId)) {
        console.log(`SHOULD NOT BE RECEIVING CLIENT_TICK BEFORE GAME START`)
        return
    }

    const prevClientTick = state.clientTicks[peerId].clientTick
    state.clientTicks[peerId] = {
        clientTick: message.clientTick,
        ackedServerTick: message.serverTick,
        capturedAt: Date.now(),
    }

    let inputs: Array<PlayerInput> = message.inputs
        .filter(elem => elem[0] > prevClientTick)
        .map(elem => elem[1])

    // This is awful anti-cheat logic. Right now clients can make 4 moves every move.
    // TODO: use bursty api logic. hold a counter from 0 that increments up by one every 16ms w/ a low max. that num represents how many moves a client can make.
    if (inputs.length > 5) {
        console.log('removing inputs for anti-cheat logic')
        inputs = _.takeRight(inputs, 5)
    }

    const party = state.parties[getPartyId(peerId)]
    if (party.status === 'PLAYING' || party.status === 'TEST') {
        stepPlayer(party.game, peerId, inputs)
    }
}

function handlePlayerUpgrades(message: PLAYER_UPGRADE_MESSAGE, peerId: string) {
    const partyId = getPartyId(peerId)
    const player = state.parties[partyId].game.players[peerId]
    const { cost, shortName } = powerups[message.powerup]

    if (player.food >= cost && message.delta === 1) {
        player.food -= cost
        player.powerups[shortName]++
    } else if (message.delta === -1 && player.powerups[shortName] > 0) {
        player.food += cost
        player.powerups[shortName]--
    }
    return player.powerups
}

/**
 *  Client/Server sync strategy.
 *
 * **Ticks**
 * Tick is a concept for both the client and the server. A tick refers to a state update. Every single time the state updates, the tick number is increased by one.
 * Therefore if the tick rate is 60hz (once every 16ms), every second will increase the tick number by 60.
 *
 * The client and server should independently have a monotonically increasing tick.
 * - A client needs to keep track of its own tick, the server's tick, and the latest ACKed `clientTick` that the server recieved.
 * - A server can maintain a single `serverTick` that is reused for all of its clients, but must maintain a unique `clientTick` and `ackedServerTick` for each client.
 *
 * The *acked* tick tells the server/client what still needs to be sent aka everything that hasn't been ACKed.
 */

function getPartyId(peerId: string) {
    return partyIndex[peerId]
}

function tick() {
    serverTick++
}
export function stepWorlds() {
    tick()
    for (const party of Object.values(state.parties)) {
        stepWorld(party, serverTick)
    }
}

export function getTickData(peerId: string): SERVER_TICK_MESSAGE {
    return {
        type: 'SERVER_TICK',
        serverTick,
        clientTick: state.clientTicks[peerId].clientTick,
        delay: Date.now() - state.clientTicks[peerId].capturedAt,
        party: state.parties[getPartyId(peerId)],
    }
}
