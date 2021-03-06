/**
 * All of the game state that is shared between servers and all clients.
 * This means only the model (state).
 */
import * as _ from 'lodash'
import { PartyState, Player, Powerup } from './state'

const GAME_DIMENSIONS = Object.freeze({ width: 769, height: 480 })
export function getGameDimensions() {
    return GAME_DIMENSIONS
}
export const HUD_HEIGHT = 40

export type World = {
    players: { [id: string]: GamePlayer }
    round: number
    roundStartTime: number
    roundTimeLeft: number
    food: Array<{
        x: number
        y: number
        rotation: number
        height: number
        width: number
    }>
    goo: Array<{
        x: number
        y: number
        height: number
        width: number
        playerNum: PlayerNumber
    }>
}

export type PlayerNumber = 1 | 2 | 3 | 4

export type PlayerInput = {
    left: boolean
    right: boolean
    up: boolean
    space: boolean
}
export type GamePlayer = {
    playerNumber: PlayerNumber
    playerName: string
    x: number
    y: number
    v: number
    friction: number
    turnSpeed: number
    acceleration: number
    rotation: number
    powerups: {
        speed: number
        goo: number
        carryLimit: number
    }
    food: number
    carriedFood: number
    height: number
    width: number
    frame: 0 | 1 | 2 | 3
    timings: {
        lastGooHit: number
        lastGooDeployed: number
        lastFrameSwitch: number
        carryLimitReached: number
        lastBaseReturn: number
        lastFoodEaten: number
    }
}

const baseSize = 70

export const PLAYER_CONFIG: { [id: number]: any } = {
    1: {
        color: '#E93F3F',
        startPosition: { x: baseSize / 2, y: baseSize / 2, rotation: Math.PI },
        basePosition: { x: 0, y: 0, width: baseSize, height: baseSize },
    },
    2: {
        color: '#38D183',
        startPosition: {
            x: getGameDimensions().width - baseSize / 2.0,
            y: baseSize / 2,
            rotation: Math.PI,
        },
        basePosition: {
            x: getGameDimensions().width - baseSize,
            y: 0,
            width: baseSize,
            height: baseSize,
        },
    },
    3: {
        color: '#3FD3E9',
        startPosition: {
            x: baseSize / 2.0,
            y: getGameDimensions().height - baseSize / 2,
            rotation: 0,
        },
        basePosition: {
            x: 0,
            y: getGameDimensions().height - baseSize,
            width: baseSize,
            height: baseSize,
        },
    },
    4: {
        color: '#E93FDB',
        startPosition: {
            x: getGameDimensions().width - baseSize / 2.0,
            y: getGameDimensions().height - baseSize / 2,
            rotation: 0,
        },
        basePosition: {
            x: getGameDimensions().width - baseSize,
            y: getGameDimensions().height - baseSize,
            width: baseSize,
            height: baseSize,
        },
    },
}

export function getDefaultPlayer(playerNum: 1 | 2 | 3 | 4, playerName: string): GamePlayer {
    return {
        ...getDefaultPosition(playerNum),
        playerNumber: playerNum,
        playerName,
        friction: 0.9,
        turnSpeed: 0.1,
        acceleration: 1.0,
        powerups: {
            speed: 0,
            goo: 5,
            carryLimit: 0,
        },
        food: 0,
        carriedFood: 0,
        height: 30,
        width: 30,
        timings: {
            carryLimitReached: 0,
            lastGooDeployed: 0,
            lastFrameSwitch: 0,
            lastGooHit: 0,
            lastBaseReturn: 0,
            lastFoodEaten: 0,
        },
        frame: 0,
    }
}

export function getDefaultPosition(playerNum: 1 | 2 | 3 | 4) {
    return {
        x: PLAYER_CONFIG[playerNum].startPosition.x,
        y: PLAYER_CONFIG[playerNum].startPosition.y,
        rotation: PLAYER_CONFIG[playerNum].startPosition.rotation,
        v: 0,
    }
}

export function getDefaultGame(players: Player[]): World {
    const gamePlayers = _.fromPairs(
        players.map((player, i) => [
            player.peerId,
            getDefaultPlayer((i + 1) as 1 | 2 | 3 | 4, player.playerName),
        ]),
    )

    return {
        players: gamePlayers,
        round: 1,
        roundStartTime: Date.now(),
        roundTimeLeft: 30,
        food: [],
        goo: [],
    }
}

/*
 * Manages events that are directly controlled by time without any user input.
 * For example:
 *   - Food creation
 *   - Time management
 *   - Round
 */
export function stepWorld(party: PartyState, serverTick: number) {
    const world: World = party.game
    if (!world) {
        return
    }

    const dt = Date.now() - world.roundStartTime
    const roundTime = party.status === 'PLAYING' ? 60 : 30
    world.roundTimeLeft = Math.floor(roundTime - dt / 1000)

    const MAX_FOOD = 40

    while (world.food.length < MAX_FOOD) {
        world.food.push({
            x: Math.floor(Math.random() * getGameDimensions().width),
            y: Math.floor(Math.random() * getGameDimensions().height),
            rotation: Math.floor(Math.random() * 360),
            height: 10,
            width: 10,
        })
    }

    if (world.roundTimeLeft <= 0) {
        // ROUND 3 alert
        if (party.status === 'UPGRADES') {
            // reset positions
            party.game.players = _.mapValues(party.game.players, (player) => ({
                ...getDefaultPosition(player.playerNumber),
                ...player,
            }))

            party.status = 'PLAYING'
            world.roundStartTime = Date.now()
            party.game.round++
        } else if (party.status === 'PLAYING') {
            if (party.game.round === 3) {
                party.status = 'FINISHED'
                return
            }
            party.status = 'UPGRADES'
            world.roundStartTime = Date.now()
        }
    }
}

export function stepPlayer(world: World, playerId: string, inputs: Array<PlayerInput>) {
    const gameDim = getGameDimensions()
    inputs = [...inputs]

    const p = world.players[playerId]
    while (!_.isEmpty(inputs)) {
        const input = inputs.shift()
        if (input.up) {
            p.v += p.acceleration
            p.v = Math.min(p.powerups.speed + 5, p.v)
            if (isSticky(p)) {
                p.v = Math.min(p.v, 0.5)
            }
        } else {
            p.v *= p.friction
        }
        if (p.v > 0.3 && Date.now() - p.timings.lastFrameSwitch > 167) {
            p.frame = ((p.frame + 1) % 4) as 0 | 1 | 2 | 3
            p.timings.lastFrameSwitch = Date.now()
        }

        p.x = p.x + Math.sin(p.rotation) * p.v
        p.y = p.y + Math.cos(p.rotation) * -1 * p.v

        if (input.left) {
            p.rotation -= p.turnSpeed
        } else if (input.right) {
            p.rotation += p.turnSpeed
        }

        p.x = Math.round(Math.min(Math.max(10, p.x), gameDim.width - 10))
        p.y = Math.round(Math.min(Math.max(10, p.y), gameDim.height - 10))
        eatFood(world, p)
        depositFood(world, p)

        runIntoGoo(world, p)
        if (input.space && p.powerups.goo > 0 && outOfCooldown(p)) {
            world.goo.push({
                playerNum: p.playerNumber,
                x: p.x - 10,
                y: p.y - 15,
                width: 20,
                height: 20,
            })
            p.powerups.goo -= 1
            p.timings.lastGooDeployed = Date.now()
        }
    }
}

function outOfCooldown(player: GamePlayer): boolean {
    const duration = 200
    return Date.now() - player.timings.lastGooDeployed > duration
}
function isSticky(player: GamePlayer): boolean {
    const duration = 5000
    return Date.now() - player.timings.lastGooHit < duration
}

function runIntoGoo(world: World, player: GamePlayer) {
    world.goo = world.goo.filter((goo) => {
        if (isTouching(goo, player) && goo.playerNum !== player.playerNumber) {
            player.timings.lastGooHit = Date.now()
            return false
        }
        return true
    })
}

function depositFood(world: World, player: GamePlayer) {
    const playerBase = PLAYER_CONFIG[player.playerNumber].basePosition
    if (isTouching(player, playerBase) && player.carriedFood > 0) {
        player.food += player.carriedFood
        player.carriedFood = 0
        player.timings.lastBaseReturn = Date.now()
    }
}

/* O(n^2): may need to improve this since it runs on each frame. */
function eatFood(world: World, player: GamePlayer) {
    world.food = world.food.filter((food) => {
        if (isTouching(food, player)) {
            if (player.carriedFood < player.powerups.carryLimit + 5) {
                player.carriedFood += 1
                player.timings.lastFoodEaten = Date.now()
                return false
            } else {
                player.timings.carryLimitReached = Date.now()
            }
        }
        return true
    })
}

export type Rectangle = { x: number; y: number; width: number; height: number }
function isTouching(rect1: Rectangle, rect2: Rectangle): boolean {
    // no horizontal overlap
    if (rect1.x > rect2.x + rect2.width || rect2.x > rect1.x + rect1.width) {
        return false
    }

    // no vertical overlap
    if (rect1.y > rect2.y + rect2.height || rect2.y > rect1.y + rect1.height) {
        return false
    }

    return true
}

export const powerups: {
    [name in Powerup]: {
        cost: number
        description: string
        shortName: 'goo' | 'speed' | 'carryLimit'
    }
} = {
    'Sticky Goo': {
        cost: 5,
        description: 'Drop sticky goo to slow your opponents down for 5 seconds.',
        shortName: 'goo',
    },
    Speed: {
        cost: 8,
        description: 'Increase your top speed.',
        shortName: 'speed',
    },
    'Food Carry Limit': {
        cost: 10,
        description: 'Increase the amount of food you can hold at once.',
        shortName: 'carryLimit',
    },
}
